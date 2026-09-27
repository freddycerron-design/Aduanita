"""
Backend FastAPI de Aduafy: expone el pipeline completo de revision
documental aduanera y clasificacion arancelaria asistida.

Maquina de estados del despacho (3 estados, dos roles distintos):
  REVISION_DOC -> CLASIFICACION -> FINALIZADO

  1. POST /despachos                                       -> crear despacho (estado=REVISION_DOC)
  2. POST /despachos/{id}/documentos  (x2 minimo: FACTURA+BL) -> subir cada PDF (RAPIDO: solo
                                                                 guarda el archivo, no llama a Gemini)
  3. DELETE /despachos/{id}/documentos/{tipo}               -> quitar un documento ya cargado (opcional;
                                                                 subir uno nuevo del mismo tipo tambien lo reemplaza)
  3b. PUT /despachos/{id}/documentos/{tipo}/contenido       -> GESTOR: corregir a mano un dato mal leido
                                                                 por el modelo. Valida contra el mismo schema
                                                                 Pydantic que la extraccion y rehace la
                                                                 validacion cruzada al instante (sin Gemini).
  4. POST /despachos/{id}/procesar-informacion              -> GESTOR, boton "Procesar informacion":
                                                                 extrae (Gemini) los documentos pendientes +
                                                                 valida + clasifica (RAG+Gemini) + genera
                                                                 borrador. NO cambia el estado (se queda en
                                                                 REVISION_DOC): se puede reprocesar cuantas
                                                                 veces haga falta antes de enviar a clasificar.
  5. POST /despachos/{id}/enviar-a-clasificacion            -> GESTOR, boton propio "Enviar a
                                                                 Clasificacion": exige FACTURA+BL ya procesados
                                                                 -> estado=CLASIFICACION. Es la unica accion
                                                                 que mueve el despacho fuera de REVISION_DOC.
  6. (el liquidador revisa la propuesta en el dashboard)
  7. POST /despachos/{id}/decision                         -> LIQUIDADOR: acepta (REVISADO) u observa
                                                                 (OBSERVADO, con motivo) -> feedback al RAG,
                                                                 estado=FINALIZADO en ambos casos (cual de las
                                                                 dos ocurrio queda en
                                                                 historial_clasificaciones.tipo_accion).

Los endpoints granulares /validar, /clasificar y /generar-borrador siguen
disponibles por separado (util para depurar via /docs), pero no mueven el
estado del despacho por si solos -- solo /enviar-a-clasificacion y
/decision lo hacen, que son las dos transiciones reales del flujo.

Administracion (solo rol ADMIN): /admin/reglas-validacion (GET/POST/PUT/
DELETE) es el CRUD del motor de reglas de validacion cruzada -- las
reglas que antes eran funciones Python hardcodeadas en
services/validation_engine.py ahora son filas de la tabla
reglas_validacion, interpretadas genericamente por ese mismo modulo.
/admin/cargos-especiales-arancel (GET/POST/PUT/DELETE) es el CRUD de
tasas de antidumping/derecho especifico por subpartida (ver
Pre-liquidacion). /admin/usuarios (GET/POST/PUT/DELETE) es el CRUD de
usuarios y roles via la API de Auth de Supabase -- crea/edita/elimina la
cuenta real, no solo el perfil. /admin/clientes (GET/POST/PUT/DELETE) es
el CRUD de los importadores, que es lo que habilita el portal externo.

Portal del cliente (/portal/*): superficie separada para el importador.
Una cuenta con rol CLIENTE ve SOLO el estado y las fechas de sus propios
despachos -- nunca hallazgos, clasificacion, pre-liquidacion ni
documentos. Dos barreras independientes lo sostienen:
  1. En la API: `get_current_staff` rechaza cuentas CLIENTE en todo
     endpoint interno, y los endpoints /portal filtran por el id_cliente
     del perfil (nunca por un parametro de la request).
  2. En la base: las RLS policies acotan la lectura directa contra
     PostgREST/Storage al personal interno, con una policy propia para
     que el cliente solo alcance sus despachos (ver database/schema.sql,
     secciones 8, 9 y 15).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, get_args, get_origin

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError, computed_field
from supabase import Client

from app.config import get_settings, get_supabase_admin_client, get_supabase_user_client
from services.arancel_service import (
    SubpartidaCandidata,
    buscar_por_codigo,
    buscar_subpartidas_candidatas,
    es_consulta_de_codigo,
)
from services.email_draft_service import (
    DespachoInfo,
    actualizar_borrador_editado,
    generar_borrador,
    guardar_borrador,
)
from services.export_service import generar_excel_despacho
from services.gemini_classifier import PropuestaClasificacion, clasificar
from services.preliquidacion_service import calcular_preliquidacion
from services.pdf_processor import (
    TIPO_A_SCHEMA,
    EXTENSION_POR_MIME,
    NivelConfianza,
    TipoArchivoNoSoportadoError,
    TipoDocumento,
    derivar_nivel_confianza,
    detectar_tipo_contenido,
    procesar_documento,
)
from services.rag_service import buscar_antecedentes, guardar_feedback
from services.validation_engine import (
    ParametrosIgualdadExacta,
    ParametrosRangoAsimetrico,
    ParametrosTextoFuzzy,
    ReglaValidacion,
    ResultadoValidacion,
    ejecutar_validaciones,
    hay_informacion_suficiente_para_clasificar,
)

settings = get_settings()

app = FastAPI(
    title="Aduafy API",
    description="Automatizacion de revision documental aduanera y clasificacion arancelaria asistida.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# Cache en memoria del proceso para la propuesta de clasificacion vigente
# de cada despacho.
#
# No se persiste en su propia tabla hasta que el especialista aprueba o
# corrige (paso en el que si queda guardada en `historial_clasificaciones`,
# ver POST /despachos/{id}/decision). Limitacion conocida del MVP: esta
# cache es por proceso, por lo que solo funciona corriendo un unico
# worker de Uvicorn (adecuado para desarrollo/demo, no para produccion
# con multiples workers/replicas).
# ---------------------------------------------------------------------
_cache_clasificaciones: dict[str, PropuestaClasificacion] = {}
_cache_info_suficiente: dict[str, bool] = {}


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------
# Autenticacion
# ---------------------------------------------------------------------

class UsuarioAutenticado(BaseModel):
    id: str
    email: str | None
    rol: str
    access_token: str
    # Solo para cuentas de portal (rol CLIENTE): a que importador pertenecen.
    # None para el personal interno.
    id_cliente: str | None = None


def get_current_user(authorization: str = Header(...)) -> UsuarioAutenticado:
    """Valida el JWT de Supabase Auth enviado en el header Authorization
    (formato 'Bearer <token>') y devuelve el usuario autenticado, incluyendo
    su rol de negocio (GESTOR/LIQUIDADOR/ADMIN interno, o CLIENTE externo
    del portal) desde perfiles_especialista."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Falta el header 'Authorization: Bearer <token>'.")

    token = authorization.removeprefix("Bearer ").strip()
    admin = get_supabase_admin_client()
    try:
        resultado = admin.auth.get_user(token)
    except Exception as error:
        raise HTTPException(status_code=401, detail=f"Token invalido o expirado: {error}") from error

    if resultado is None or resultado.user is None:
        raise HTTPException(status_code=401, detail="Token invalido o expirado.")

    perfil = (
        admin.table("perfiles_especialista")
        .select("rol, id_cliente")
        .eq("id", resultado.user.id)
        .execute()
    )
    # Sin perfil no hay rol: se rechaza en vez de asumir uno. Antes esto
    # caia por defecto en GESTOR, lo cual con cuentas externas en el
    # sistema seria una escalada de privilegios -- p.ej. al eliminar un
    # cliente, la cascada borra el perfil de sus cuentas de portal pero la
    # cuenta de Auth sigue viva, y con el default vieja esa cuenta pasaba
    # a ser tratada como personal interno en su siguiente login.
    if not perfil.data:
        raise HTTPException(
            status_code=403,
            detail="Tu cuenta no tiene un perfil asignado. Contacta al administrador.",
        )

    fila = perfil.data[0]
    return UsuarioAutenticado(
        id=resultado.user.id,
        email=resultado.user.email,
        rol=fila["rol"],
        access_token=token,
        id_cliente=fila.get("id_cliente"),
    )


def get_current_staff(usuario: UsuarioAutenticado = Depends(get_current_user)) -> UsuarioAutenticado:
    """Igual que `get_current_user`, pero rechaza las cuentas EXTERNAS del
    portal (rol CLIENTE).

    Todo endpoint interno depende de esta funcion y no de
    `get_current_user`: varios endpoints de lectura (listar despachos,
    exportar Excel, metricas...) no tenian mas control que "estar
    autenticado", lo cual dejo de alcanzar al existir cuentas de cliente
    -- sin esto, un importador podria listar los despachos de todos. El
    backend consulta la base con service_role, asi que las policies RLS
    no lo cubren: la barrera tiene que estar aca."""
    if usuario.rol == "CLIENTE":
        raise HTTPException(
            status_code=403,
            detail="Esta acción es solo para el personal interno de la agencia.",
        )
    return usuario


def get_current_cliente(usuario: UsuarioAutenticado = Depends(get_current_user)) -> UsuarioAutenticado:
    """Inversa de `get_current_staff`: solo cuentas de portal, y solo si
    tienen un cliente vinculado (una cuenta CLIENTE sin id_cliente no
    puede ver nada -- cierra por defecto)."""
    if usuario.rol != "CLIENTE" or not usuario.id_cliente:
        raise HTTPException(
            status_code=403,
            detail="Esta sección es solo para cuentas de cliente del portal.",
        )
    return usuario


def _requiere_rol(usuario: UsuarioAutenticado, roles_permitidos: set[str]) -> None:
    """Verifica que el usuario tenga uno de los roles permitidos para la
    accion (ADMIN siempre esta autorizado, sin importar la lista)."""
    if usuario.rol != "ADMIN" and usuario.rol not in roles_permitidos:
        raise HTTPException(
            status_code=403,
            detail=f"Esta accion requiere el rol {'/'.join(sorted(roles_permitidos))} (tu rol es {usuario.rol}).",
        )


# ---------------------------------------------------------------------
# Modelos de request/response
# ---------------------------------------------------------------------

class DespachoCreate(BaseModel):
    numero_despacho: str
    cliente: str
    # Libre, opcional -- identifica de un vistazo que trae el despacho en
    # la grilla del Explorador antes de que haya documentos procesados.
    descripcion: str | None = None
    # Opcional: vincula el despacho a un importador registrado, lo que lo
    # hace visible en su portal. Sin esto el despacho existe igual, pero
    # solo con el nombre en texto libre y sin portal.
    id_cliente: str | None = None
    # Gestor asignado a trabajar el despacho. Opcional a nivel API (si no
    # llega, se asigna a quien lo crea) pero el formulario lo exige
    # siempre -- ver comentario en la columna, database/schema.sql seccion 2.
    id_gestor: str | None = None


class DespachoOut(BaseModel):
    id: str
    numero_despacho: str
    cliente: str
    descripcion: str | None = None
    estado: str
    fecha_creacion: str
    id_cliente: str | None = None
    # Nombre de quien creo el despacho (perfiles_especialista.nombre_completo
    # via el FK creado_por). Solo lo puebla el listado paginado (ver
    # listar_despachos): un embed por fila no vale la pena en los demas
    # endpoints, que ya traen un solo despacho a la vez.
    gestor: str | None = None


class DespachoListadoOut(BaseModel):
    """Respuesta de GET /despachos: la pagina pedida + el total de filas
    que hay en total (ignorando la paginacion, respetando la busqueda) --
    lo que necesita la grilla del Explorador para dibujar sus controles de
    pagina sin tener que traer todos los despachos de una."""

    items: list[DespachoOut]
    total: int


class GestorDistintoOut(BaseModel):
    """Una entrada del filtro "estilo Excel" de la columna Gestor -- el id
    (lo que de verdad filtra, via creado_por) junto al nombre que se
    muestra en el checkbox."""

    id: str
    nombre_completo: str


def _columnas_por_lista(tipo_documento: TipoDocumento) -> dict[str, list[str]]:
    """Para cada campo de tipo lista del schema (ej. `items` de la factura),
    los nombres de las columnas de sus filas.

    Lo necesita el formulario de correccion manual del frontend, que arma
    los campos a partir del JSON guardado: si la lista llego vacia no hay
    de donde deducir las columnas, y sin esto no se podria agregar la
    primera fila a mano.
    """
    columnas: dict[str, list[str]] = {}
    for nombre, campo in TIPO_A_SCHEMA[tipo_documento].model_fields.items():
        if get_origin(campo.annotation) is not list:
            continue
        argumentos = get_args(campo.annotation)
        if argumentos and isinstance(argumentos[0], type) and issubclass(argumentos[0], BaseModel):
            columnas[nombre] = list(argumentos[0].model_fields)
    return columnas


class DocumentoExtraidoOut(BaseModel):
    id: str
    tipo_documento: TipoDocumento
    contenido_json: dict
    url_pdf_storage: str
    # Ambos quedan en None/False mientras el documento esta subido pero
    # todavia no se proceso (ver _ejecutar_extraccion_pendiente).
    metodo_extraccion: str | None = None
    procesado: bool = False
    confianza_extraccion: float | None = None
    # Que campos dijo el modelo que no pudo leer con seguridad, para que el
    # formulario de correccion los resalte. Se vacia cuando una persona ya
    # reviso el documento a mano (ver actualizar_contenido_documento).
    campos_inciertos: list[str] = Field(default_factory=list)
    # Marca de correccion manual: mientras sea None, el contenido_json es
    # tal cual lo leyo el modelo.
    editado_en: str | None = None

    @computed_field
    @property
    def nivel_confianza(self) -> NivelConfianza | None:
        """Etiqueta que ve el especialista, derivada del score numerico. Se
        calcula aca y no en el frontend para que los umbrales vivan en un
        solo lugar (services/pdf_processor.py)."""
        if self.confianza_extraccion is None:
            return None
        return derivar_nivel_confianza(self.confianza_extraccion)

    @computed_field
    @property
    def columnas_por_lista(self) -> dict[str, list[str]]:
        """Columnas de los campos de tipo lista de este tipo de documento
        (ver `_columnas_por_lista`)."""
        return _columnas_por_lista(self.tipo_documento)


class ContenidoDocumentoUpdate(BaseModel):
    """Datos de un documento corregidos a mano por el especialista. El
    shape queda libre a proposito: la validacion real la hace el schema
    Pydantic del tipo de documento (TIPO_A_SCHEMA), el mismo con el que se
    valida lo que extrae Gemini -- dos definiciones del mismo documento se
    desincronizarian."""

    contenido_json: dict


class ResultadoValidacionOut(ResultadoValidacion):
    pass


class PropuestaClasificacionOut(PropuestaClasificacion):
    pass


CanalEnvio = Literal["CORREO", "WHATSAPP", "AMBOS"]


class BorradorCorreoOut(BaseModel):
    id: str
    tipo: str
    asunto: str
    cuerpo: str
    cuerpo_editado: str | None = None
    # Registro de intencion, nada mas -- no hay integracion de correo ni
    # de WhatsApp que de verdad envie algo (ver comentario en el schema).
    canal_envio: CanalEnvio = "CORREO"


class DespachoDetalleOut(BaseModel):
    despacho: DespachoOut
    documentos: list[DocumentoExtraidoOut]
    validaciones: list[ResultadoValidacionOut]
    clasificacion: PropuestaClasificacionOut | None
    borrador: BorradorCorreoOut | None
    # Decision ya persistida del liquidador (aceptada u observada, ver
    # tipo_accion). Es la fuente de verdad para despachos ya FINALIZADOs:
    # `clasificacion` es una cache en memoria del proceso que se limpia
    # justo al decidir (ver registrar_decision), asi que no sirve para
    # mostrar el resultado final.
    decision: HistorialClasificacionOut | None = None
    # Snapshot ya calculado de la pre-liquidacion (null si aun no se
    # presiono "Calcular" en esa pestana).
    preliquidacion: PreliquidacionOut | None = None


class ActualizarBorradorRequest(BaseModel):
    """Al menos uno de los dos debe venir -- el endpoint solo actualiza
    los campos presentes (editar el texto y elegir el canal son dos
    acciones independientes en la UI, ver ComunicacionesTab)."""

    cuerpo_editado: str | None = None
    canal_envio: CanalEnvio | None = None


class DecisionRequest(BaseModel):
    # REVISADO: el liquidador acepta la propuesta de la IA tal cual.
    # OBSERVADO: el liquidador la rechaza/corrige (motivo_modificacion obligatorio).
    accion: Literal["REVISADO", "OBSERVADO"]
    subpartida_sugerida_ia: str
    subpartida_final: str
    descripcion_comercial: str
    atributos: dict = Field(default_factory=dict)
    motivo_modificacion: str | None = None


class HistorialClasificacionOut(BaseModel):
    id: str
    id_despacho: str | None
    subpartida_sugerida_ia: str
    subpartida_final_humano: str
    tipo_accion: str
    motivo_modificacion: str | None = None
    peso_prioridad: float
    aprobado_por: str


class PipelineResultOut(BaseModel):
    validaciones: list[ResultadoValidacionOut]
    clasificacion: PropuestaClasificacionOut
    borrador: BorradorCorreoOut
    estado_final: str


class ReglaValidacionUpsert(BaseModel):
    codigo: str
    nombre: str
    descripcion: str | None = None
    activo: bool = True
    documento_a: TipoDocumento
    campo_a: str
    documento_b: TipoDocumento
    campo_b: str
    campo_moneda_a: str | None = None
    campo_moneda_b: str | None = None
    severidad_moneda_distinta: Literal["ALTA", "MEDIA", "NINGUNA"] | None = None
    severidad_dato_faltante: Literal["ALTA", "MEDIA", "NINGUNA"]
    tipo_comparacion: Literal["RANGO_ASIMETRICO", "IGUALDAD_EXACTA", "TEXTO_FUZZY"]
    # Shape depende de tipo_comparacion -- ver ParametrosRangoAsimetrico/
    # ParametrosIgualdadExacta/ParametrosTextoFuzzy en validation_engine.py,
    # validado en _validar_regla_o_400 antes de persistir.
    parametros: dict


class ReglaValidacionOut(ReglaValidacionUpsert):
    id: str
    creado_en: str
    actualizado_en: str


class CargoEspecialArancelUpsert(BaseModel):
    subpartida: str
    antidumping_monto: float = 0
    derecho_especifico_monto: float = 0
    moneda: str = "USD"
    nota: str | None = None


class CargoEspecialArancelOut(CargoEspecialArancelUpsert):
    id: str
    creado_en: str
    actualizado_en: str


class PreliquidacionOut(BaseModel):
    id: str
    id_despacho: str
    subpartida: str
    valor_cif: float
    moneda: str
    ad_valorem_tasa: float
    ad_valorem_monto: float
    base_igv_ipm: float
    igv_monto: float
    ipm_monto: float
    antidumping_monto: float
    derecho_especifico_monto: float
    total_tributos: float
    actualizado_en: str


class CalcularPreliquidacionRequest(BaseModel):
    valor_cif: float
    moneda: str = "USD"
    # Si vienen null, se usa el default de cargos_especiales_arancel para
    # la subpartida vigente (o 0 si tampoco hay default cargado).
    antidumping_monto: float | None = None
    derecho_especifico_monto: float | None = None


class PreliquidacionDetalleOut(BaseModel):
    """Respuesta de GET /preliquidacion: la fila ya calculada (si existe),
    mas todo lo que el frontend necesita para precargar el formulario sin
    otra ida y vuelta."""

    preliquidacion: PreliquidacionOut | None
    subpartida_vigente: str | None
    cargo_especial_default: CargoEspecialArancelOut | None


class MetricasOut(BaseModel):
    """Agregados para la pantalla de inicio (ver GET /metricas)."""

    en_revision: int
    en_clasificacion: int
    finalizados: int
    hallazgos_altos_abiertos: int


# CLIENTE es una cuenta EXTERNA del portal, no un 4to rol del equipo
# interno -- ver get_current_staff/get_current_cliente.
RolUsuario = Literal["GESTOR", "LIQUIDADOR", "ADMIN", "CLIENTE"]


class UsuarioOut(BaseModel):
    id: str
    email: str | None
    nombre_completo: str
    rol: RolUsuario
    activo: bool
    creado_en: str
    # Obligatorio en la practica para rol CLIENTE (sin esto la cuenta no ve
    # nada); siempre None para el personal interno.
    id_cliente: str | None = None


class UsuarioCreate(BaseModel):
    email: str
    password: str
    nombre_completo: str
    rol: RolUsuario
    id_cliente: str | None = None


class UsuarioUpdate(BaseModel):
    nombre_completo: str
    rol: RolUsuario
    activo: bool
    id_cliente: str | None = None
    # Si viene, resetea la contrasena de Auth; si no, se ignora (no se
    # puede "vaciar" una contrasena, omitir el campo es la forma de no
    # tocarla).
    password: str | None = None


TipoPersona = Literal["NATURAL", "JURIDICA"]
TipoDocumentoIdentidad = Literal["DNI", "RUC"]


class ClienteUpsert(BaseModel):
    """Datos del mantenimiento de Importadores. El nombre interno del
    modelo/tabla sigue siendo "cliente" (no se renombra para no romper
    las FKs/RLS ya en produccion) -- "Importador" es como se llama en
    toda la interfaz."""

    razon_social: str
    # Codigo interno opcional para identificar al importador (no es el id uuid).
    codigo: str | None = None
    tipo_persona: TipoPersona
    tipo_documento: TipoDocumentoIdentidad
    numero_documento: str
    # Calle y numero en un solo campo (ej. "Av. Larco 123").
    direccion_calle: str | None = None
    distrito: str | None = None
    departamento: str | None = None
    pais: str | None = None
    nombre_contacto: str | None = None
    telefono_contacto: str | None = None
    email_contacto: str | None = None
    activo: bool = True


class ClienteOut(ClienteUpsert):
    id: str
    creado_en: str
    actualizado_en: str


class PortalDespachoOut(BaseModel):
    """Vista que el importador ve de SU despacho en el portal.

    Deliberadamente minima: estado y fechas, nada del trabajo interno --
    ni hallazgos de validacion, ni la propuesta de clasificacion, ni la
    pre-liquidacion, ni los documentos originales. Si algo no esta en
    este modelo, no sale por el portal."""

    id: str
    numero_despacho: str
    estado: str
    fecha_creacion: str
    actualizado_en: str | None = None


# ---------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------

def _obtener_despacho_o_404(admin: Client, id_despacho: str) -> dict:
    respuesta = admin.table("despachos").select("*").eq("id", id_despacho).execute()
    if not respuesta.data:
        raise HTTPException(status_code=404, detail=f"No existe un despacho con id {id_despacho}.")
    return respuesta.data[0]


def _obtener_regla_o_404(admin: Client, id_regla: str) -> dict:
    respuesta = admin.table("reglas_validacion").select("*").eq("id", id_regla).execute()
    if not respuesta.data:
        raise HTTPException(status_code=404, detail=f"No existe una regla de validacion con id {id_regla}.")
    return respuesta.data[0]


def _obtener_cargo_especial_o_404(admin: Client, id_cargo: str) -> dict:
    respuesta = admin.table("cargos_especiales_arancel").select("*").eq("id", id_cargo).execute()
    if not respuesta.data:
        raise HTTPException(status_code=404, detail=f"No existe un cargo especial con id {id_cargo}.")
    return respuesta.data[0]


def _obtener_subpartida_vigente(admin: Client, id_despacho: str) -> str | None:
    """La subpartida a usar para pre-liquidacion: la decision ya persistida
    del liquidador si existe (fuente de verdad, sin importar el estado
    actual del despacho), o si no la propuesta de la IA en cache mientras
    el despacho todavia no se decide."""
    decision_respuesta = (
        admin.table("historial_clasificaciones")
        .select("subpartida_final_humano")
        .eq("id_despacho", id_despacho)
        .order("creado_en", desc=True)
        .limit(1)
        .execute()
    )
    if decision_respuesta.data:
        return decision_respuesta.data[0]["subpartida_final_humano"]

    clasificacion = _cache_clasificaciones.get(id_despacho)
    return clasificacion.subpartida_sugerida if clasificacion else None


def _obtener_cargo_especial_por_subpartida(admin: Client, subpartida: str) -> dict | None:
    respuesta = (
        admin.table("cargos_especiales_arancel").select("*").eq("subpartida", subpartida).execute()
    )
    return respuesta.data[0] if respuesta.data else None


_PARAMETROS_POR_TIPO: dict[str, type[BaseModel]] = {
    "RANGO_ASIMETRICO": ParametrosRangoAsimetrico,
    "IGUALDAD_EXACTA": ParametrosIgualdadExacta,
    "TEXTO_FUZZY": ParametrosTextoFuzzy,
}


def _validar_regla_o_400(datos: ReglaValidacionUpsert) -> dict:
    """Valida una regla de validacion antes de persistirla: que campo_a/
    campo_b existan de verdad en el schema Pydantic del documento
    correspondiente (services/pdf_processor.TIPO_A_SCHEMA), que el par de
    campos de moneda venga completo o vacio, y que `parametros` tenga el
    shape correcto segun `tipo_comparacion`. Devuelve el dict listo para
    insert/update, con `parametros` ya normalizado contra su schema."""
    for documento, campo in ((datos.documento_a, datos.campo_a), (datos.documento_b, datos.campo_b)):
        if campo not in TIPO_A_SCHEMA[documento].model_fields:
            raise HTTPException(
                status_code=400,
                detail=f"El campo '{campo}' no existe en el schema de {documento}.",
            )

    if (datos.campo_moneda_a is None) != (datos.campo_moneda_b is None):
        raise HTTPException(
            status_code=400,
            detail="campo_moneda_a y campo_moneda_b deben venir juntos (ambos vacios o ambos completos).",
        )
    if datos.campo_moneda_a and not datos.severidad_moneda_distinta:
        raise HTTPException(
            status_code=400,
            detail="severidad_moneda_distinta es obligatoria cuando se configura un chequeo de moneda.",
        )

    try:
        modelo_parametros = _PARAMETROS_POR_TIPO[datos.tipo_comparacion].model_validate(datos.parametros)
    except ValidationError as error:
        raise HTTPException(
            status_code=400, detail=f"parametros invalido para {datos.tipo_comparacion}: {error}"
        ) from error

    return {**datos.model_dump(exclude={"parametros"}), "parametros": modelo_parametros.model_dump()}


def _actualizar_estado_despacho(admin: Client, id_despacho: str, estado: str) -> None:
    admin.table("despachos").update({"estado": estado, "actualizado_en": _ahora_iso()}).eq(
        "id", id_despacho
    ).execute()


def _obtener_documentos_extraidos(admin: Client, id_despacho: str) -> list[dict]:
    respuesta = admin.table("documentos_extraidos").select("*").eq("id_despacho", id_despacho).execute()
    return respuesta.data or []


def _documentos_a_modelos(filas: list[dict]) -> dict[TipoDocumento, BaseModel]:
    """Reconstruye los objetos Pydantic (FacturaSchema, BLSchema, etc.) a
    partir del contenido_json ya persistido, para reutilizarlos en las
    validaciones y en la clasificacion sin volver a llamar a Gemini.

    Los documentos subidos pero aun no procesados (procesado=False,
    contenido_json='{}') se omiten -- para validar/clasificar se tratan
    igual que si no se hubieran cargado todavia.
    """
    documentos: dict[TipoDocumento, BaseModel] = {}
    for fila in filas:
        if not fila.get("procesado"):
            continue
        tipo: TipoDocumento = fila["tipo_documento"]
        schema = TIPO_A_SCHEMA[tipo]
        documentos[tipo] = schema.model_validate(fila["contenido_json"])
    return documentos


def _ejecutar_extraccion_pendiente(admin: Client, id_despacho: str) -> None:
    """Extrae con Gemini el contenido_json de todos los documentos
    subidos pero aun no procesados de este despacho (procesado=False).

    Es el primer paso de "Procesar informacion": si falla la extraccion
    de un documento REQUERIDO (FACTURA o BL), aborta con 422 y ninguno de
    los pasos siguientes (validar/clasificar) se ejecuta. Si falla un
    documento opcional (SEGURO/SWIFT_BANCARIO), se omite y se continua --
    ese documento simplemente sigue apareciendo como no procesado.
    """
    filas = _obtener_documentos_extraidos(admin, id_despacho)
    pendientes = [f for f in filas if not f.get("procesado")]
    errores_criticos: list[str] = []

    for fila in pendientes:
        tipo: TipoDocumento = fila["tipo_documento"]
        try:
            pdf_bytes = admin.storage.from_(settings.supabase_storage_bucket).download(fila["url_pdf_storage"])
            resultado = procesar_documento(pdf_bytes, tipo)
        except Exception as error:  # ExtraccionFallidaError u otro error de red/API
            if tipo in ("FACTURA", "BL"):
                errores_criticos.append(f"{tipo}: {error}")
            continue

        # No hace falta limpiar editado_por/editado_en aca: solo se extraen
        # los documentos con procesado=false, y esa marca ya la limpia
        # subir_documento al reemplazar el archivo (una correccion manual
        # deja el documento en procesado=true, asi que nunca se re-extrae
        # sola por encima).
        admin.table("documentos_extraidos").update({
            "contenido_json": resultado.datos.model_dump(mode="json"),
            "metodo_extraccion": resultado.metodo_extraccion,
            "procesado": True,
            "confianza_extraccion": resultado.score_confianza,
            "campos_inciertos": resultado.campos_inciertos,
        }).eq("id_despacho", id_despacho).eq("tipo_documento", tipo).execute()

    if errores_criticos:
        raise HTTPException(
            status_code=422,
            detail="No se pudo extraer informacion de documentos requeridos: " + "; ".join(errores_criticos),
        )


def _obtener_validaciones(admin: Client, id_despacho: str) -> list[ResultadoValidacion]:
    respuesta = (
        admin.table("resultados_validacion").select("*").eq("id_despacho", id_despacho).execute()
    )
    return [ResultadoValidacion.model_validate(fila) for fila in (respuesta.data or [])]


def _obtener_reglas_activas(admin: Client) -> list[ReglaValidacion]:
    respuesta = admin.table("reglas_validacion").select("*").eq("activo", True).execute()
    return [ReglaValidacion.model_validate(fila) for fila in (respuesta.data or [])]


def _ejecutar_validacion(admin: Client, id_despacho: str) -> list[ResultadoValidacion]:
    filas = _obtener_documentos_extraidos(admin, id_despacho)
    documentos = _documentos_a_modelos(filas)

    # Ya no hay un minimo de documentos hardcodeado aca: con el motor
    # generico, cada regla activa evalua independientemente y reporta
    # "dato faltante" si el documento que necesita no esta -- correr sin
    # ningun documento simplemente produce N resultados de ese tipo, un
    # comportamiento valido que no hace falta bloquear. El gate de negocio
    # real (no tiene sentido "procesar" sin Factura+BL) sigue viviendo en
    # el frontend (DOCUMENTOS_MINIMOS) y en _ejecutar_clasificacion (que
    # exige Factura por su cuenta, sin relacion con este motor).
    reglas = _obtener_reglas_activas(admin)
    resultados = ejecutar_validaciones(documentos, reglas)

    # Se limpian los resultados previos para evitar duplicados si el
    # especialista vuelve a correr la validacion (p.ej. tras corregir un PDF).
    admin.table("resultados_validacion").delete().eq("id_despacho", id_despacho).execute()
    filas_insertar = [
        {"id_despacho": id_despacho, **r.model_dump()} for r in resultados
    ]
    if filas_insertar:  # insert([]) puede fallar; con 0 reglas activas no hay nada que guardar
        admin.table("resultados_validacion").insert(filas_insertar).execute()

    # La validacion en si no mueve el estado del despacho (se queda en
    # REVISION_DOC); las discrepancias quedan disponibles en el tab de
    # revision para que el especialista decida cuando enviar a clasificar.
    return resultados


def _ejecutar_clasificacion(admin: Client, id_despacho: str) -> PropuestaClasificacion:
    filas = _obtener_documentos_extraidos(admin, id_despacho)
    documentos = _documentos_a_modelos(filas)

    if "FACTURA" not in documentos:
        raise HTTPException(status_code=400, detail="Se requiere la Factura cargada para poder clasificar.")

    factura = documentos["FACTURA"]  # type: ignore[assignment]
    info_suficiente = hay_informacion_suficiente_para_clasificar(factura)

    atributos = {
        "incoterm": factura.incoterm,
        "materiales_declarados": [
            item.material_declarado for item in factura.items if item.material_declarado
        ],
    }
    antecedentes = buscar_antecedentes(admin, factura.descripcion_mercancia, atributos)
    candidatas_arancel = buscar_subpartidas_candidatas(admin, factura.descripcion_mercancia)
    propuesta = clasificar(factura.descripcion_mercancia, factura.items, antecedentes, candidatas_arancel)

    _cache_clasificaciones[id_despacho] = propuesta
    _cache_info_suficiente[id_despacho] = info_suficiente
    # El cambio de estado a CLASIFICACION lo hace el endpoint
    # enviar-a-clasificacion (una accion aparte, ver mas abajo) -- este
    # paso (llamado por procesar-informacion) nunca toca el estado.

    return propuesta


def _ejecutar_generacion_borrador(admin: Client, id_despacho: str) -> dict:
    if id_despacho not in _cache_clasificaciones:
        raise HTTPException(
            status_code=400,
            detail="Debe ejecutar POST /despachos/{id}/clasificar antes de generar el borrador de correo.",
        )

    despacho = _obtener_despacho_o_404(admin, id_despacho)
    validaciones = _obtener_validaciones(admin, id_despacho)
    clasificacion = _cache_clasificaciones[id_despacho]
    info_suficiente = _cache_info_suficiente.get(id_despacho, False)

    borrador = generar_borrador(
        DespachoInfo(numero_despacho=despacho["numero_despacho"], cliente=despacho["cliente"]),
        validaciones,
        clasificacion,
        info_suficiente,
    )
    # guardar_borrador devuelve la fila ya persistida (con su id), que es
    # lo que necesitan tanto el endpoint individual como el pipeline
    # completo para responder con BorradorCorreoOut.
    return guardar_borrador(admin, id_despacho, borrador)


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/portal/despachos", response_model=list[PortalDespachoOut])
def portal_listar_despachos(
    usuario: UsuarioAutenticado = Depends(get_current_cliente),
) -> list[dict]:
    """Portal del cliente: los despachos del importador autenticado.

    El filtro por `id_cliente` sale del perfil del usuario, NUNCA de un
    parametro de la request -- asi no hay forma de pedir los despachos de
    otro cliente cambiando la URL. `response_model=PortalDespachoOut`
    ademas recorta la respuesta a estado y fechas aunque la consulta
    trajera mas columnas."""
    admin = get_supabase_admin_client()
    respuesta = (
        admin.table("despachos")
        .select("id, numero_despacho, estado, fecha_creacion, actualizado_en")
        .eq("id_cliente", usuario.id_cliente)
        .order("fecha_creacion", desc=True)
        .execute()
    )
    return respuesta.data or []


@app.get("/portal/despachos/{id_despacho}", response_model=PortalDespachoOut)
def portal_obtener_despacho(
    id_despacho: str,
    usuario: UsuarioAutenticado = Depends(get_current_cliente),
) -> dict:
    """Detalle de UN despacho del portal. La pertenencia se comprueba en la
    misma consulta (`id` + `id_cliente`): pedir el id de un despacho ajeno
    devuelve 404, no 403 -- no confirma ni desmiente que ese despacho
    exista."""
    admin = get_supabase_admin_client()
    respuesta = (
        admin.table("despachos")
        .select("id, numero_despacho, estado, fecha_creacion, actualizado_en")
        .eq("id", id_despacho)
        .eq("id_cliente", usuario.id_cliente)
        .execute()
    )
    if not respuesta.data:
        raise HTTPException(status_code=404, detail="No existe ese despacho.")
    return respuesta.data[0]


@app.get("/metricas", response_model=MetricasOut)
def obtener_metricas(usuario: UsuarioAutenticado = Depends(get_current_staff)) -> dict:
    """Numeros de la pantalla de inicio: cuantos despachos hay en cada
    estado y cuantos hallazgos criticos siguen abiertos. Cualquier
    autenticado puede verlos (son agregados del equipo, no datos de un
    despacho puntual)."""
    admin = get_supabase_admin_client()

    def contar_despachos(estado: str) -> int:
        respuesta = admin.table("despachos").select("id", count="exact").eq("estado", estado).execute()
        return respuesta.count or 0

    # Hallazgos de severidad ALTA que siguen vivos: el join embebido
    # (`despachos!inner`) filtra por el estado del despacho padre, para no
    # contar los de despachos ya cerrados.
    hallazgos = (
        admin.table("resultados_validacion")
        .select("id, despachos!inner(estado)", count="exact")
        .eq("severidad", "ALTA")
        .neq("despachos.estado", "FINALIZADO")
        .execute()
    )

    return {
        "en_revision": contar_despachos("REVISION_DOC"),
        "en_clasificacion": contar_despachos("CLASIFICACION"),
        "finalizados": contar_despachos("FINALIZADO"),
        "hallazgos_altos_abiertos": hallazgos.count or 0,
    }


@app.get("/arancel/buscar", response_model=list[SubpartidaCandidata])
def buscar_en_arancel(
    q: str,
    limite: int = 25,
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> list[SubpartidaCandidata]:
    """Consulta libre del Arancel Nacional (tabla partidas_arancelarias, la
    misma que ya alimenta al clasificador como contexto). Dos modos segun
    lo que escriba el usuario, resueltos en services/arancel_service.py:

    - Si `q` son solo digitos y puntos ("9011", "9011.10"), busca por
      PREFIJO de codigo -- util cuando ya se sabe la partida y se quiere
      ver sus aperturas.
    - Si no, busca por TEXTO sobre la descripcion oficial (full-text con
      semantica OR, la misma RPC que usa el clasificador).

    Devuelve lista vacia si la consulta viene vacia, en vez de traer las
    8000 partidas.
    """
    consulta = q.strip()
    if not consulta:
        return []

    admin = get_supabase_admin_client()
    limite = max(1, min(limite, 100))
    if es_consulta_de_codigo(consulta):
        return buscar_por_codigo(admin, consulta, limite)
    return buscar_subpartidas_candidatas(admin, consulta, limite)


@app.post("/despachos", response_model=DespachoOut)
def crear_despacho(datos: DespachoCreate, usuario: UsuarioAutenticado = Depends(get_current_staff)) -> dict:
    admin = get_supabase_admin_client()
    fila = {
        "numero_despacho": datos.numero_despacho,
        "cliente": datos.cliente,
        "descripcion": datos.descripcion,
        # creado_por es auditoria pura y siempre es quien hace el POST,
        # nunca lo que venga en el body. id_gestor si puede diferir --
        # por defecto es el creador, pero el formulario deja elegir a
        # otro miembro del equipo.
        "creado_por": usuario.id,
        "id_gestor": datos.id_gestor or usuario.id,
        "id_cliente": datos.id_cliente,
    }
    respuesta = admin.table("despachos").insert(fila).execute()
    return respuesta.data[0]


def _escapar_valor_or(valor: str) -> str:
    """Escapa los caracteres que PostgREST interpreta como sintaxis dentro
    de un filtro `.or_(...)` (la coma separa condiciones, los parentesis
    agrupan), para que un termino de busqueda que los contenga (ej. un
    cliente escrito "Comercial Sur (SAC), Perú") no rompa el filtro ni se
    cuele como una condicion aparte. Verificado contra Supabase real: sin
    esto, ese mismo termino devuelve un error de sintaxis del filtro."""
    return valor.replace("\\", "\\\\").replace(",", "\\,").replace("(", "\\(").replace(")", "\\)")


_CAMPOS_ORDEN_DESPACHOS = ("fecha_creacion", "numero_despacho")


@app.get("/despachos", response_model=DespachoListadoOut)
def listar_despachos(
    pagina: int = 1,
    limite: int = 20,
    busqueda: str | None = None,
    # Listas (?estados=A&estados=B) para los filtros "estilo Excel" de las
    # columnas Estado y Cliente -- Query(default=None) es lo que le dice a
    # FastAPI que un query param repetido se junte en una lista, en vez de
    # aceptar solo el ultimo valor.
    estados: list[str] | None = Query(default=None),
    clientes: list[str] | None = Query(default=None),
    # Filtra por el ID del gestor asignado (id_gestor), no por su nombre --
    # dos personas podrian compartir nombre_completo, el ID nunca se repite.
    gestores: list[str] | None = Query(default=None),
    orden_campo: str = "fecha_creacion",
    orden_direccion: str = "desc",
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> dict:
    """Listado paginado de despachos para la pestaña Explorador.
    `busqueda` filtra por coincidencia parcial (sin distinguir mayusculas)
    en numero_despacho, cliente o descripcion a la vez; `estados`/
    `clientes`/`gestores` filtran por coincidencia EXACTA contra una lista
    de valores elegidos en el header de esas columnas (checkbox, no texto
    libre). El nombre del gestor ASIGNADO (id_gestor, no creado_por --
    quien crea el despacho y quien lo trabaja pueden ser personas
    distintas) viaja embebido via ese FK (PostgREST resuelve el join),
    asi que la grilla no necesita una consulta por fila para mostrarlo.

    `limite` tope en 500 (no 100): la vista "agrupar por cliente/estado"
    (frontend) agrupa del lado del cliente sobre TODO lo que haya
    filtrado, en una sola pagina grande -- no pagina dentro de cada grupo.
    Sigue habiendo un tope (nunca "sin limite") para no poder pedir la
    tabla entera de una."""
    admin = get_supabase_admin_client()
    pagina = max(pagina, 1)
    limite = min(max(limite, 1), 500)
    inicio = (pagina - 1) * limite

    if orden_campo not in _CAMPOS_ORDEN_DESPACHOS:
        raise HTTPException(
            status_code=400,
            detail=f"orden_campo debe ser uno de {_CAMPOS_ORDEN_DESPACHOS} (recibido: {orden_campo}).",
        )
    if orden_direccion not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="orden_direccion debe ser 'asc' o 'desc'.")

    consulta = (
        admin.table("despachos")
        .select("*, gestor:perfiles_especialista!id_gestor(nombre_completo)", count="exact")
        .order(orden_campo, desc=(orden_direccion == "desc"))
    )
    if estados:
        consulta = consulta.in_("estado", estados)
    if clientes:
        consulta = consulta.in_("cliente", clientes)
    if gestores:
        consulta = consulta.in_("id_gestor", gestores)
    if busqueda and busqueda.strip():
        termino = _escapar_valor_or(busqueda.strip())
        consulta = consulta.or_(
            f"numero_despacho.ilike.%{termino}%,cliente.ilike.%{termino}%,descripcion.ilike.%{termino}%"
        )

    respuesta = consulta.range(inicio, inicio + limite - 1).execute()
    items = []
    for fila in respuesta.data or []:
        gestor = fila.pop("gestor", None)
        fila["gestor"] = gestor["nombre_completo"] if gestor else None
        items.append(fila)

    return {"items": items, "total": respuesta.count or 0}


@app.get("/despachos/clientes-distintos", response_model=list[str])
def listar_clientes_distintos_de_despachos(
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> list[str]:
    """Valores unicos de `despachos.cliente` que existen hoy, para poblar
    el filtro "estilo Excel" de la columna Cliente en el Explorador.

    No es lo mismo que `/admin/clientes` (los importadores REGISTRADOS en
    la tabla `clientes`, que habilitan el portal): esto son los textos
    libres que de hecho aparecen en algun despacho, esten o no vinculados
    a un cliente registrado. Debe registrarse ANTES de
    `GET /despachos/{id_despacho}` (mismo prefijo, dos segmentos): si no,
    esa ruta dinamica capturaria "clientes-distintos" como si fuera un id.

    PostgREST no ofrece `DISTINCT` a traves del query builder; se trae
    la columna sola (liviano, es solo texto) y se deduplica en Python --
    a esta escala (decenas o cientos de despachos, no millones) es mas
    simple que una funcion RPC dedicada."""
    admin = get_supabase_admin_client()
    respuesta = admin.table("despachos").select("cliente").order("cliente").execute()
    vistos: set[str] = set()
    distintos: list[str] = []
    for fila in respuesta.data or []:
        valor = fila["cliente"]
        if valor not in vistos:
            vistos.add(valor)
            distintos.append(valor)
    return distintos


@app.get("/despachos/gestores-distintos", response_model=list[GestorDistintoOut])
def listar_gestores_distintos_de_despachos(
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> list[dict]:
    """Gestores (perfiles_especialista) ASIGNADOS a al menos un despacho
    (id_gestor, no creado_por), para poblar el filtro "estilo Excel" de
    la columna Gestor -- solo lista a quien de verdad aparece en la
    grilla, no a todo el staff (para eso ver gestores-asignables).

    El filtro real (`gestores=` en `GET /despachos`) es por ID, no por
    nombre: dos cuentas distintas podrian compartir nombre_completo, y el
    ID nunca se repite. Debe registrarse ANTES de
    `GET /despachos/{id_despacho}` (mismo prefijo, dos segmentos)."""
    admin = get_supabase_admin_client()
    respuesta = (
        admin.table("despachos")
        .select("id_gestor, gestor:perfiles_especialista!id_gestor(nombre_completo)")
        .execute()
    )
    vistos: dict[str, str] = {}
    for fila in respuesta.data or []:
        id_gestor = fila.get("id_gestor")
        if not id_gestor or id_gestor in vistos:
            continue
        gestor = fila.get("gestor") or {}
        vistos[id_gestor] = gestor.get("nombre_completo") or "(sin nombre)"
    return sorted(
        ({"id": id_gestor, "nombre_completo": nombre} for id_gestor, nombre in vistos.items()),
        key=lambda g: g["nombre_completo"].lower(),
    )


@app.get("/despachos/gestores-asignables", response_model=list[GestorDistintoOut])
def listar_gestores_asignables(
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> list[dict]:
    """Personal que puede quedar como gestor asignado de un despacho
    NUEVO (Select del formulario de creacion) -- GESTOR o ADMIN, activos.

    A diferencia de gestores-distintos (que solo lista a quien YA tiene
    algun despacho, util para el filtro de la grilla), esta lista tiene
    que incluir tambien a alguien recien contratado que todavia no tiene
    ninguno -- si no, no se lo podria asignar nunca el primero. LIQUIDADOR
    queda afuera: ese rol decide la clasificacion, no trabaja documentos."""
    admin = get_supabase_admin_client()
    respuesta = (
        admin.table("perfiles_especialista")
        .select("id, nombre_completo")
        .in_("rol", ["GESTOR", "ADMIN"])
        .eq("activo", True)
        .order("nombre_completo")
        .execute()
    )
    return respuesta.data or []


def _armar_detalle_despacho(admin: Client, id_despacho: str) -> dict:
    """Arma el detalle completo de un despacho (despacho + documentos +
    validaciones + clasificacion en cache + borrador + decision
    persistida). Compartido por `obtener_despacho` (respuesta JSON normal)
    y `exportar_despacho_excel` (mismos datos, formato .xlsx) -- una sola
    fuente de verdad para no repetir las mismas 3 consultas dos veces."""
    despacho = _obtener_despacho_o_404(admin, id_despacho)
    documentos = _obtener_documentos_extraidos(admin, id_despacho)
    validaciones = _obtener_validaciones(admin, id_despacho)
    clasificacion = _cache_clasificaciones.get(id_despacho)

    borrador_respuesta = (
        admin.table("borradores_correo")
        .select("*")
        .eq("id_despacho", id_despacho)
        .order("generado_en", desc=True)
        .limit(1)
        .execute()
    )
    borrador = borrador_respuesta.data[0] if borrador_respuesta.data else None

    decision_respuesta = (
        admin.table("historial_clasificaciones")
        .select("*")
        .eq("id_despacho", id_despacho)
        .order("creado_en", desc=True)
        .limit(1)
        .execute()
    )
    decision = decision_respuesta.data[0] if decision_respuesta.data else None

    preliquidacion_respuesta = (
        admin.table("preliquidaciones").select("*").eq("id_despacho", id_despacho).execute()
    )
    preliquidacion = preliquidacion_respuesta.data[0] if preliquidacion_respuesta.data else None

    return {
        "despacho": despacho,
        "documentos": documentos,
        "validaciones": validaciones,
        "clasificacion": clasificacion,
        "borrador": borrador,
        "decision": decision,
        "preliquidacion": preliquidacion,
    }


@app.get("/despachos/{id_despacho}", response_model=DespachoDetalleOut)
def obtener_despacho(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)) -> dict:
    admin = get_supabase_admin_client()
    return _armar_detalle_despacho(admin, id_despacho)


@app.get("/despachos/{id_despacho}/exportar-excel")
def exportar_despacho_excel(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)) -> Response:
    """Exporta los mismos datos de `obtener_despacho` a un libro de Excel
    (4 hojas: Despacho, Documentos, Validaciones, Clasificación). La
    exportacion a JSON no tiene endpoint propio -- el frontend ya tiene
    ese mismo detalle cargado y arma el archivo del lado del cliente."""
    admin = get_supabase_admin_client()
    detalle = _armar_detalle_despacho(admin, id_despacho)
    contenido = generar_excel_despacho(detalle)
    nombre_archivo = f"despacho_{detalle['despacho']['numero_despacho']}.xlsx"
    return Response(
        content=contenido,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )


@app.get("/despachos/{id_despacho}/preliquidacion", response_model=PreliquidacionDetalleOut)
def obtener_preliquidacion(
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    """Trae la pre-liquidacion ya calculada (si existe) mas la subpartida
    vigente y el default de cargos_especiales_arancel para esa subpartida,
    todo junto para que el frontend precargue el formulario de una sola
    llamada."""
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)

    preliquidacion_respuesta = (
        admin.table("preliquidaciones").select("*").eq("id_despacho", id_despacho).execute()
    )
    preliquidacion = preliquidacion_respuesta.data[0] if preliquidacion_respuesta.data else None

    subpartida_vigente = _obtener_subpartida_vigente(admin, id_despacho)
    cargo_default = (
        _obtener_cargo_especial_por_subpartida(admin, subpartida_vigente) if subpartida_vigente else None
    )

    return {
        "preliquidacion": preliquidacion,
        "subpartida_vigente": subpartida_vigente,
        "cargo_especial_default": cargo_default,
    }


@app.post("/despachos/{id_despacho}/preliquidacion/calcular", response_model=PreliquidacionOut)
def calcular_preliquidacion_despacho(
    id_despacho: str,
    datos: CalcularPreliquidacionRequest,
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> dict:
    """Calcula (o recalcula) los tributos del despacho y sobreescribe el
    snapshot en `preliquidaciones` (upsert por id_despacho). El especialista
    o el liquidador pueden hacerlo -- no esta atado a una unica transicion
    de estado, se puede recalcular cuantas veces haga falta."""
    _requiere_rol(usuario, {"GESTOR", "LIQUIDADOR"})

    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)

    subpartida = _obtener_subpartida_vigente(admin, id_despacho)
    if not subpartida:
        raise HTTPException(
            status_code=400,
            detail="Aún no hay una subpartida determinada; completa la Clasificación primero.",
        )

    partida_respuesta = (
        admin.table("partidas_arancelarias").select("ad_valorem").eq("codigo", subpartida).execute()
    )
    if not partida_respuesta.data:
        raise HTTPException(
            status_code=400,
            detail=f"La subpartida {subpartida} no existe en el arancel nacional cargado.",
        )
    ad_valorem_tasa = partida_respuesta.data[0]["ad_valorem"] or 0

    antidumping_monto = datos.antidumping_monto
    derecho_especifico_monto = datos.derecho_especifico_monto
    if antidumping_monto is None or derecho_especifico_monto is None:
        cargo_default = _obtener_cargo_especial_por_subpartida(admin, subpartida)
        if antidumping_monto is None:
            antidumping_monto = cargo_default["antidumping_monto"] if cargo_default else 0
        if derecho_especifico_monto is None:
            derecho_especifico_monto = cargo_default["derecho_especifico_monto"] if cargo_default else 0

    resultado = calcular_preliquidacion(
        valor_cif=datos.valor_cif,
        ad_valorem_tasa=ad_valorem_tasa,
        antidumping_monto=antidumping_monto,
        derecho_especifico_monto=derecho_especifico_monto,
    )

    fila = {
        "id_despacho": id_despacho,
        "subpartida": subpartida,
        "moneda": datos.moneda,
        "actualizado_por": usuario.id,
        "actualizado_en": _ahora_iso(),
        **resultado.model_dump(),
    }
    respuesta = admin.table("preliquidaciones").upsert(fila, on_conflict="id_despacho").execute()
    return respuesta.data[0]


@app.post("/despachos/{id_despacho}/documentos", response_model=DocumentoExtraidoOut)
def subir_documento(
    id_despacho: str,
    tipo_documento: TipoDocumento = Form(...),
    archivo: UploadFile = File(...),
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> dict:
    """Sube el documento (PDF o imagen) a Storage y registra un marcador
    'pendiente de procesar' -- NO llama a Gemini aqui (por eso es rapida).
    La extraccion real se hace en bloque, para todos los documentos
    pendientes del despacho a la vez, al presionar "Procesar informacion"
    (ver enviar_a_clasificacion / _ejecutar_extraccion_pendiente). Si ya
    existia un documento de este tipo, subir uno nuevo lo reemplaza
    automaticamente (upsert); la decision de que estrategia de extraccion
    usar (texto de PDF vs. Gemini Vision) se toma recien en ese paso, en
    `services.pdf_processor.procesar_documento`.

    El tipo real del archivo (PDF/JPG/PNG/WEBP/HEIC) se detecta por su firma
    binaria, no por la extension del nombre ni el Content-Type del
    navegador -- ver `pdf_processor.detectar_tipo_contenido`."""
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)  # 404 si el despacho no existe

    if tipo_documento not in TIPO_A_SCHEMA:
        raise HTTPException(status_code=400, detail=f"tipo_documento invalido: {tipo_documento}")

    contenido = archivo.file.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo subido esta vacio.")

    try:
        mime = detectar_tipo_contenido(contenido)
    except TipoArchivoNoSoportadoError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    path_storage = f"{id_despacho}/{tipo_documento}.{EXTENSION_POR_MIME[mime]}"

    # Si ya existia un documento de este tipo con OTRA extension (p.ej. se
    # habia subido un PDF y ahora se reemplaza por una foto JPG), el nuevo
    # path no pisa al anterior -- hay que borrar el objeto viejo a mano
    # para no dejarlo huerfano en Storage.
    filas_previas = _obtener_documentos_extraidos(admin, id_despacho)
    fila_previa = next((f for f in filas_previas if f["tipo_documento"] == tipo_documento), None)
    if fila_previa and fila_previa["url_pdf_storage"] != path_storage:
        try:
            admin.storage.from_(settings.supabase_storage_bucket).remove([fila_previa["url_pdf_storage"]])
        except Exception:
            pass  # si ya no existia en Storage, no es un error

    admin.storage.from_(settings.supabase_storage_bucket).upload(
        path_storage, contenido, {"content-type": mime, "upsert": "true"}
    )

    # El upsert reemplaza la fila entera a proposito: el archivo es otro, asi
    # que TODO lo que se sabia del anterior deja de ser cierto -- incluida
    # una correccion manual previa, que era sobre el documento viejo.
    fila = {
        "id_despacho": id_despacho,
        "tipo_documento": tipo_documento,
        "contenido_json": {},
        "url_pdf_storage": path_storage,
        "metodo_extraccion": None,
        "procesado": False,
        "confianza_extraccion": None,
        "campos_inciertos": [],
        "editado_por": None,
        "editado_en": None,
    }
    respuesta = admin.table("documentos_extraidos").upsert(
        fila, on_conflict="id_despacho,tipo_documento"
    ).execute()

    # Subir un documento no mueve el estado del despacho: se queda en
    # REVISION_DOC hasta que el especialista presione "Procesar informacion".
    return respuesta.data[0]


@app.delete("/despachos/{id_despacho}/documentos/{tipo_documento}")
def eliminar_documento(
    id_despacho: str,
    tipo_documento: TipoDocumento,
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> dict:
    """Elimina un documento ya cargado (PDF en Storage + fila en
    documentos_extraidos), para que el especialista pueda quitarlo antes de
    volver a cargar uno distinto. No es estrictamente necesario para
    reemplazar un documento (subir uno nuevo del mismo tipo ya lo
    sobrescribe via upsert), pero permite quitarlo sin cargar otro."""
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)

    # El path real depende de la extension del archivo subido (PDF, JPG,
    # PNG...), por eso se lee de la fila en vez de asumir ".pdf".
    filas = _obtener_documentos_extraidos(admin, id_despacho)
    fila = next((f for f in filas if f["tipo_documento"] == tipo_documento), None)
    if fila:
        try:
            admin.storage.from_(settings.supabase_storage_bucket).remove([fila["url_pdf_storage"]])
        except Exception:
            pass  # si el archivo ya no existia en Storage, no es un error

    admin.table("documentos_extraidos").delete().eq("id_despacho", id_despacho).eq(
        "tipo_documento", tipo_documento
    ).execute()

    return {"status": "ok"}


def _mensaje_validacion_legible(error: ValidationError) -> str:
    """Traduce un ValidationError de Pydantic a algo que se pueda mostrar
    tal cual en el formulario ('monto_total: Input should be a valid
    number'), en vez del repr completo con el modelo y las urls de
    documentacion."""
    return "; ".join(
        f"{'.'.join(str(parte) for parte in detalle['loc']) or '(raiz)'}: {detalle['msg']}"
        for detalle in error.errors()
    )


@app.put(
    "/despachos/{id_despacho}/documentos/{tipo_documento}/contenido",
    response_model=DocumentoExtraidoOut,
)
def actualizar_contenido_documento(
    id_despacho: str,
    tipo_documento: TipoDocumento,
    datos: ContenidoDocumentoUpdate,
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> dict:
    """Corrige a mano lo que el modelo leyo de un documento.

    Hasta aca, un dato mal extraido solo se podia arreglar volviendo a
    procesar el documento y esperando que saliera distinto. Esta accion lo
    reemplaza por una correccion directa: el cuerpo se valida contra el
    MISMO schema Pydantic que valida la salida de Gemini
    (TIPO_A_SCHEMA[tipo]), asi que un campo mal tipeado se rechaza con 400
    en vez de guardar basura que despues rompa la validacion cruzada.

    Guardar re-ejecuta la validacion cruzada al instante (`_ejecutar_validacion`
    es Python puro + base de datos, sin costo de Gemini) para que las
    discrepancias reflejen el dato corregido. La clasificacion NO se
    rehace sola: esa si cuesta una llamada al modelo y sigue detras del
    boton "Procesar informacion".
    """
    _requiere_rol(usuario, {"GESTOR"})

    admin = get_supabase_admin_client()
    despacho = _obtener_despacho_o_404(admin, id_despacho)

    # Un despacho FINALIZADO ya tiene su decision registrada y sus hallazgos
    # son el registro de lo que se reviso: re-ejecutar la validacion sobre
    # el reescribiria esa historia.
    if despacho["estado"] == "FINALIZADO":
        raise HTTPException(
            status_code=400,
            detail="No se pueden corregir los datos de un despacho ya finalizado.",
        )

    filas = _obtener_documentos_extraidos(admin, id_despacho)
    fila = next((f for f in filas if f["tipo_documento"] == tipo_documento), None)
    if fila is None:
        raise HTTPException(
            status_code=404, detail=f"El despacho no tiene un documento de tipo {tipo_documento}."
        )
    if not fila.get("procesado"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"El {tipo_documento} todavia no se ha procesado. Presiona 'Procesar informacion' "
                f"antes de corregir sus datos."
            ),
        )

    try:
        modelo = TIPO_A_SCHEMA[tipo_documento].model_validate(datos.contenido_json)
    except ValidationError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Los datos corregidos no son validos -- {_mensaje_validacion_legible(error)}",
        ) from error

    respuesta = (
        admin.table("documentos_extraidos")
        .update({
            "contenido_json": modelo.model_dump(mode="json"),
            "editado_por": usuario.id,
            "editado_en": _ahora_iso(),
            # El formulario muestra todos los campos, asi que quien guarda
            # acaba de revisar tambien los que el modelo habia marcado como
            # dudosos. El score numerico se conserva como registro de lo que
            # dijo la maquina; la marca de edicion manual es la que manda.
            "campos_inciertos": [],
        })
        .eq("id_despacho", id_despacho)
        .eq("tipo_documento", tipo_documento)
        .execute()
    )

    _ejecutar_validacion(admin, id_despacho)

    return respuesta.data[0]


@app.post("/despachos/{id_despacho}/validar", response_model=list[ResultadoValidacionOut])
def validar_despacho(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)) -> list[dict]:
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)
    resultados = _ejecutar_validacion(admin, id_despacho)
    return [r.model_dump() for r in resultados]


@app.post("/despachos/{id_despacho}/clasificar", response_model=PropuestaClasificacionOut)
def clasificar_despacho(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)) -> dict:
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)
    propuesta = _ejecutar_clasificacion(admin, id_despacho)
    return propuesta.model_dump()


@app.post("/despachos/{id_despacho}/generar-borrador", response_model=BorradorCorreoOut)
def generar_borrador_despacho(
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)
    return _ejecutar_generacion_borrador(admin, id_despacho)


@app.patch("/borradores/{id_borrador}", response_model=BorradorCorreoOut)
def editar_borrador(
    id_borrador: str,
    datos: ActualizarBorradorRequest,
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> dict:
    if datos.cuerpo_editado is None and datos.canal_envio is None:
        raise HTTPException(
            status_code=400, detail="Debes enviar cuerpo_editado, canal_envio, o ambos."
        )
    cliente_usuario = get_supabase_user_client(usuario.access_token)
    actualizado = actualizar_borrador_editado(
        cliente_usuario, id_borrador, usuario.id, datos.cuerpo_editado, datos.canal_envio
    )
    return actualizado


@app.post("/despachos/{id_despacho}/decision", response_model=HistorialClasificacionOut)
def registrar_decision(
    id_despacho: str,
    datos: DecisionRequest,
    usuario: UsuarioAutenticado = Depends(get_current_staff),
) -> dict:
    # Solo el liquidador (o un admin) puede aceptar/observar la propuesta
    # de clasificacion -- es la accion que cierra el flujo del despacho.
    _requiere_rol(usuario, {"LIQUIDADOR"})

    admin = get_supabase_admin_client()
    despacho = _obtener_despacho_o_404(admin, id_despacho)
    if despacho["estado"] != "CLASIFICACION":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Solo se puede aceptar/observar un despacho en estado CLASIFICACION "
                f"(estado actual: {despacho['estado']}). Primero debe enviarse a clasificacion."
            ),
        )

    if datos.accion == "OBSERVADO" and not datos.motivo_modificacion:
        raise HTTPException(status_code=400, detail="motivo_modificacion es obligatorio cuando accion='OBSERVADO'.")

    # El feedback al RAG usa internamente el vocabulario APROBADO/EDITADO
    # (peso_prioridad de historial_clasificaciones), independiente del
    # estado del despacho (que ahora es siempre FINALIZADO al decidir,
    # sin importar accion -- ver mas abajo).
    tipo_accion_rag = "APROBADO" if datos.accion == "REVISADO" else "EDITADO"

    cliente_usuario = get_supabase_user_client(usuario.access_token)
    fila_creada = guardar_feedback(
        cliente_usuario,
        id_despacho=id_despacho,
        descripcion_comercial=datos.descripcion_comercial,
        atributos=datos.atributos,
        subpartida_sugerida_ia=datos.subpartida_sugerida_ia,
        subpartida_final_humano=datos.subpartida_final,
        tipo_accion=tipo_accion_rag,
        aprobado_por=usuario.id,
        motivo_modificacion=datos.motivo_modificacion,
    )

    # El despacho pasa a FINALIZADO sin importar si accion fue REVISADO u
    # OBSERVADO -- esa distincion queda registrada en tipo_accion_rag
    # (historial_clasificaciones.tipo_accion), no en el estado del despacho.
    _actualizar_estado_despacho(admin, id_despacho, "FINALIZADO")
    _cache_clasificaciones.pop(id_despacho, None)
    _cache_info_suficiente.pop(id_despacho, None)

    return fila_creada


@app.post("/despachos/{id_despacho}/procesar-informacion", response_model=PipelineResultOut)
def procesar_informacion(
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    """Accion del especialista ("Procesar informacion"): extrae con Gemini
    los documentos pendientes -> valida -> clasifica -> genera-borrador. NO
    cambia el estado del despacho (se queda en REVISION_DOC) -- se puede
    presionar cuantas veces haga falta (p.ej. tras cargar un documento
    nuevo) antes de enviarlo a clasificacion con el boton propio para eso
    (ver `enviar_a_clasificacion` mas abajo). Es el unico punto donde se
    llama a Gemini para extraccion: subir_documento solo guarda el archivo
    (rapido, sin extraer)."""
    _requiere_rol(usuario, {"GESTOR"})

    admin = get_supabase_admin_client()
    despacho = _obtener_despacho_o_404(admin, id_despacho)

    _ejecutar_extraccion_pendiente(admin, id_despacho)
    validaciones = _ejecutar_validacion(admin, id_despacho)
    clasificacion = _ejecutar_clasificacion(admin, id_despacho)
    borrador = _ejecutar_generacion_borrador(admin, id_despacho)

    return {
        "validaciones": [v.model_dump() for v in validaciones],
        "clasificacion": clasificacion.model_dump(),
        "borrador": borrador,
        "estado_final": despacho["estado"],
    }


@app.post("/despachos/{id_despacho}/enviar-a-clasificacion", response_model=DespachoOut)
def enviar_a_clasificacion(
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    """Accion del especialista, boton propio "Enviar a Clasificacion": es
    la UNICA transicion de REVISION_DOC -> CLASIFICACION. A diferencia de
    `procesar_informacion`, esta no llama a Gemini ni recalcula nada -- solo
    exige que FACTURA y BL ya esten procesados (mismo criterio que
    DOCUMENTOS_MINIMOS en el frontend) y mueve el estado, dejando el
    despacho listo para que el liquidador lo revise."""
    _requiere_rol(usuario, {"GESTOR"})

    admin = get_supabase_admin_client()
    despacho = _obtener_despacho_o_404(admin, id_despacho)

    if despacho["estado"] != "REVISION_DOC":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Solo se puede enviar a clasificacion un despacho en estado REVISION_DOC "
                f"(estado actual: {despacho['estado']})."
            ),
        )

    filas = _obtener_documentos_extraidos(admin, id_despacho)
    procesados = {f["tipo_documento"] for f in filas if f.get("procesado")}
    faltantes = {"FACTURA", "BL"} - procesados
    if faltantes:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Faltan procesar: {', '.join(sorted(faltantes))}. "
                f"Presiona 'Procesar información' antes de enviar a clasificación."
            ),
        )

    _actualizar_estado_despacho(admin, id_despacho, "CLASIFICACION")
    return _obtener_despacho_o_404(admin, id_despacho)


# ---------------------------------------------------------------------
# Administracion (solo ADMIN): CRUD de reglas de validacion
# ---------------------------------------------------------------------

@app.get("/admin/reglas-validacion", response_model=list[ReglaValidacionOut])
def listar_reglas_validacion(usuario: UsuarioAutenticado = Depends(get_current_staff)) -> list[dict]:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    return admin.table("reglas_validacion").select("*").order("nombre").execute().data or []


@app.post("/admin/reglas-validacion", response_model=ReglaValidacionOut)
def crear_regla_validacion(
    datos: ReglaValidacionUpsert, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    fila = _validar_regla_o_400(datos)
    fila["creado_por"] = usuario.id
    try:
        respuesta = admin.table("reglas_validacion").insert(fila).execute()
    except Exception as error:
        if "duplicate key" in str(error) or "23505" in str(error):
            raise HTTPException(
                status_code=400, detail=f"Ya existe una regla con codigo '{datos.codigo}'."
            ) from error
        raise
    return respuesta.data[0]


@app.put("/admin/reglas-validacion/{id_regla}", response_model=ReglaValidacionOut)
def actualizar_regla_validacion(
    id_regla: str, datos: ReglaValidacionUpsert, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    _obtener_regla_o_404(admin, id_regla)
    fila = _validar_regla_o_400(datos)
    fila["actualizado_en"] = _ahora_iso()
    try:
        respuesta = admin.table("reglas_validacion").update(fila).eq("id", id_regla).execute()
    except Exception as error:
        if "duplicate key" in str(error) or "23505" in str(error):
            raise HTTPException(
                status_code=400, detail=f"Ya existe una regla con codigo '{datos.codigo}'."
            ) from error
        raise
    return respuesta.data[0]


@app.delete("/admin/reglas-validacion/{id_regla}")
def eliminar_regla_validacion(
    id_regla: str, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    _obtener_regla_o_404(admin, id_regla)
    admin.table("reglas_validacion").delete().eq("id", id_regla).execute()
    return {"status": "ok"}


# ---------------------------------------------------------------------
# Administracion (solo ADMIN): CRUD de cargos especiales del arancel
# (antidumping / derecho especifico por subpartida -- ver Pre-liquidacion)
# ---------------------------------------------------------------------

def _validar_cargo_especial_o_400(admin: Client, datos: CargoEspecialArancelUpsert) -> None:
    """La subpartida debe existir en partidas_arancelarias -- evita cargar
    tasas contra codigos inexistentes/mal tipeados."""
    respuesta = (
        admin.table("partidas_arancelarias").select("codigo").eq("codigo", datos.subpartida).execute()
    )
    if not respuesta.data:
        raise HTTPException(
            status_code=400,
            detail=f"La subpartida '{datos.subpartida}' no existe en el arancel nacional cargado.",
        )


@app.get("/admin/cargos-especiales-arancel", response_model=list[CargoEspecialArancelOut])
def listar_cargos_especiales(usuario: UsuarioAutenticado = Depends(get_current_staff)) -> list[dict]:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    return admin.table("cargos_especiales_arancel").select("*").order("subpartida").execute().data or []


@app.post("/admin/cargos-especiales-arancel", response_model=CargoEspecialArancelOut)
def crear_cargo_especial(
    datos: CargoEspecialArancelUpsert, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    _validar_cargo_especial_o_400(admin, datos)
    fila = datos.model_dump()
    fila["creado_por"] = usuario.id
    try:
        respuesta = admin.table("cargos_especiales_arancel").insert(fila).execute()
    except Exception as error:
        if "duplicate key" in str(error) or "23505" in str(error):
            raise HTTPException(
                status_code=400, detail=f"Ya existe un cargo especial para la subpartida '{datos.subpartida}'."
            ) from error
        raise
    return respuesta.data[0]


@app.put("/admin/cargos-especiales-arancel/{id_cargo}", response_model=CargoEspecialArancelOut)
def actualizar_cargo_especial(
    id_cargo: str, datos: CargoEspecialArancelUpsert, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    _obtener_cargo_especial_o_404(admin, id_cargo)
    _validar_cargo_especial_o_400(admin, datos)
    fila = datos.model_dump()
    fila["actualizado_en"] = _ahora_iso()
    try:
        respuesta = admin.table("cargos_especiales_arancel").update(fila).eq("id", id_cargo).execute()
    except Exception as error:
        if "duplicate key" in str(error) or "23505" in str(error):
            raise HTTPException(
                status_code=400, detail=f"Ya existe un cargo especial para la subpartida '{datos.subpartida}'."
            ) from error
        raise
    return respuesta.data[0]


@app.delete("/admin/cargos-especiales-arancel/{id_cargo}")
def eliminar_cargo_especial(
    id_cargo: str, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    _obtener_cargo_especial_o_404(admin, id_cargo)
    admin.table("cargos_especiales_arancel").delete().eq("id", id_cargo).execute()
    return {"status": "ok"}


# ---------------------------------------------------------------------
# Administracion (solo ADMIN): CRUD de usuarios y roles
# ---------------------------------------------------------------------
# A diferencia de reglas_validacion/cargos_especiales_arancel (filas
# comunes de Postgres), un "usuario" es una cuenta real de Supabase Auth
# -- crear/eliminar pasa por `admin.auth.admin.*`, no por un simple
# insert/delete en una tabla. `perfiles_especialista` (rol, nombre,
# activo) se mantiene en sincronia con esas llamadas.

def _obtener_perfil_o_404(admin: Client, id_usuario: str) -> dict:
    respuesta = admin.table("perfiles_especialista").select("*").eq("id", id_usuario).execute()
    if not respuesta.data:
        raise HTTPException(status_code=404, detail=f"No existe un usuario con id {id_usuario}.")
    return respuesta.data[0]


def _contar_admins(admin: Client) -> int:
    respuesta = admin.table("perfiles_especialista").select("id", count="exact").eq("rol", "ADMIN").execute()
    return respuesta.count or 0


def _verificar_no_es_ultimo_admin(admin: Client, perfil: dict) -> None:
    """Salvaguarda anti-lockout: si el usuario objetivo es ADMIN y es el
    unico que queda, no se puede degradar su rol ni eliminarlo -- dejaria
    la app sin nadie que pueda administrarla."""
    if perfil["rol"] == "ADMIN" and _contar_admins(admin) <= 1:
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar ni cambiar el rol del único administrador restante.",
        )


@app.get("/admin/usuarios", response_model=list[UsuarioOut])
def listar_usuarios(usuario: UsuarioAutenticado = Depends(get_current_staff)) -> list[dict]:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    perfiles = admin.table("perfiles_especialista").select("*").order("creado_en").execute().data or []
    emails_por_id = {u.id: u.email for u in admin.auth.admin.list_users()}
    return [{**perfil, "email": emails_por_id.get(perfil["id"])} for perfil in perfiles]


@app.post("/admin/usuarios", response_model=UsuarioOut)
def crear_usuario(datos: UsuarioCreate, usuario: UsuarioAutenticado = Depends(get_current_staff)) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()

    try:
        respuesta_auth = admin.auth.admin.create_user(
            {"email": datos.email, "password": datos.password, "email_confirm": True}
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"No se pudo crear el usuario: {error}") from error

    id_usuario = respuesta_auth.user.id
    # El trigger handle_new_user() (database/schema.sql) ya creo la fila de
    # perfiles_especialista con nombre_completo=email y rol=GESTOR (default
    # de la columna) -- se actualiza de inmediato con los valores reales.
    admin.table("perfiles_especialista").update(
        {
            "nombre_completo": datos.nombre_completo,
            "rol": datos.rol,
            # Solo tiene sentido para cuentas de portal; para el personal
            # interno se fuerza a None aunque venga algo en el request.
            "id_cliente": datos.id_cliente if datos.rol == "CLIENTE" else None,
        }
    ).eq("id", id_usuario).execute()

    return {**_obtener_perfil_o_404(admin, id_usuario), "email": datos.email}


@app.put("/admin/usuarios/{id_usuario}", response_model=UsuarioOut)
def actualizar_usuario(
    id_usuario: str, datos: UsuarioUpdate, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    perfil_actual = _obtener_perfil_o_404(admin, id_usuario)

    if datos.rol != "ADMIN":
        _verificar_no_es_ultimo_admin(admin, perfil_actual)

    if datos.password:
        try:
            admin.auth.admin.update_user_by_id(id_usuario, {"password": datos.password})
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"No se pudo actualizar la contraseña: {error}") from error

    admin.table("perfiles_especialista").update(
        {
            "nombre_completo": datos.nombre_completo,
            "rol": datos.rol,
            "activo": datos.activo,
            "id_cliente": datos.id_cliente if datos.rol == "CLIENTE" else None,
        }
    ).eq("id", id_usuario).execute()

    perfil_actualizado = _obtener_perfil_o_404(admin, id_usuario)
    email = next((u.email for u in admin.auth.admin.list_users() if u.id == id_usuario), None)
    return {**perfil_actualizado, "email": email}


@app.delete("/admin/usuarios/{id_usuario}")
def eliminar_usuario(id_usuario: str, usuario: UsuarioAutenticado = Depends(get_current_staff)) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    perfil = _obtener_perfil_o_404(admin, id_usuario)
    _verificar_no_es_ultimo_admin(admin, perfil)

    try:
        admin.auth.admin.delete_user(id_usuario)  # cascada: borra tambien perfiles_especialista
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"No se pudo eliminar el usuario: {error}") from error

    return {"status": "ok"}


# ---------------------------------------------------------------------
# Administracion (solo ADMIN): CRUD de clientes
# ---------------------------------------------------------------------
# Un "cliente" es el importador dueno de los despachos. Registrarlo aca es
# lo que habilita el portal externo: los despachos se vinculan a una fila
# de esta tabla, y una cuenta con rol CLIENTE se vincula al mismo id.

def _obtener_cliente_o_404(admin: Client, id_cliente: str) -> dict:
    respuesta = admin.table("clientes").select("*").eq("id", id_cliente).execute()
    if not respuesta.data:
        raise HTTPException(status_code=404, detail=f"No existe un importador con id {id_cliente}.")
    return respuesta.data[0]


@app.get("/admin/clientes", response_model=list[ClienteOut])
def listar_clientes(usuario: UsuarioAutenticado = Depends(get_current_staff)) -> list[dict]:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    return admin.table("clientes").select("*").order("razon_social").execute().data or []


@app.post("/admin/clientes", response_model=ClienteOut)
def crear_cliente(
    datos: ClienteUpsert, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    try:
        respuesta = admin.table("clientes").insert(datos.model_dump()).execute()
    except Exception as error:
        if "duplicate key" in str(error) or "23505" in str(error):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Ya existe un importador con {datos.tipo_documento} '{datos.numero_documento}' "
                    f"o con el código '{datos.codigo}'."
                ),
            ) from error
        raise
    return respuesta.data[0]


@app.put("/admin/clientes/{id_cliente}", response_model=ClienteOut)
def actualizar_cliente(
    id_cliente: str, datos: ClienteUpsert, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    _obtener_cliente_o_404(admin, id_cliente)
    fila = datos.model_dump()
    fila["actualizado_en"] = _ahora_iso()
    try:
        respuesta = admin.table("clientes").update(fila).eq("id", id_cliente).execute()
    except Exception as error:
        if "duplicate key" in str(error) or "23505" in str(error):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Ya existe un importador con {datos.tipo_documento} '{datos.numero_documento}' "
                    f"o con el código '{datos.codigo}'."
                ),
            ) from error
        raise
    return respuesta.data[0]


@app.delete("/admin/clientes/{id_cliente}")
def eliminar_cliente(
    id_cliente: str, usuario: UsuarioAutenticado = Depends(get_current_staff)
) -> dict:
    """Eliminar un importador NO borra sus despachos: la FK es ON DELETE
    SET NULL, asi que los despachos quedan con su nombre en texto libre y
    dejan de ser visibles en el portal. Las cuentas de portal de ese
    importador si se eliminan en cascada (ON DELETE CASCADE sobre
    perfiles_especialista), porque una cuenta CLIENTE sin importador no
    tendria nada que mostrar."""
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    _obtener_cliente_o_404(admin, id_cliente)
    admin.table("clientes").delete().eq("id", id_cliente).execute()
    return {"status": "ok"}
