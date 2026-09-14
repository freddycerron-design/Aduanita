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
usuarios y roles (GESTOR/LIQUIDADOR/ADMIN) via la API de Auth de
Supabase -- crea/edita/elimina la cuenta real, no solo el perfil.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from supabase import Client

from app.config import get_settings, get_supabase_admin_client, get_supabase_user_client
from services.arancel_service import buscar_subpartidas_candidatas
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
    TipoArchivoNoSoportadoError,
    TipoDocumento,
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


def get_current_user(authorization: str = Header(...)) -> UsuarioAutenticado:
    """Valida el JWT de Supabase Auth enviado en el header Authorization
    (formato 'Bearer <token>') y devuelve el usuario autenticado, incluyendo
    su rol de negocio (GESTOR/LIQUIDADOR/ADMIN) desde perfiles_especialista."""
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
        admin.table("perfiles_especialista").select("rol").eq("id", resultado.user.id).execute()
    )
    rol = perfil.data[0]["rol"] if perfil.data else "GESTOR"

    return UsuarioAutenticado(id=resultado.user.id, email=resultado.user.email, rol=rol, access_token=token)


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


class DespachoOut(BaseModel):
    id: str
    numero_despacho: str
    cliente: str
    estado: str
    fecha_creacion: str


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


class ResultadoValidacionOut(ResultadoValidacion):
    pass


class PropuestaClasificacionOut(PropuestaClasificacion):
    pass


class BorradorCorreoOut(BaseModel):
    id: str
    tipo: str
    asunto: str
    cuerpo: str
    cuerpo_editado: str | None = None


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
    cuerpo_editado: str


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


RolUsuario = Literal["GESTOR", "LIQUIDADOR", "ADMIN"]


class UsuarioOut(BaseModel):
    id: str
    email: str | None
    nombre_completo: str
    rol: RolUsuario
    activo: bool
    creado_en: str


class UsuarioCreate(BaseModel):
    email: str
    password: str
    nombre_completo: str
    rol: RolUsuario


class UsuarioUpdate(BaseModel):
    nombre_completo: str
    rol: RolUsuario
    activo: bool
    # Si viene, resetea la contrasena de Auth; si no, se ignora (no se
    # puede "vaciar" una contrasena, omitir el campo es la forma de no
    # tocarla).
    password: str | None = None


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
            modelo, metodo_extraccion = procesar_documento(pdf_bytes, tipo)
        except Exception as error:  # ExtraccionFallidaError u otro error de red/API
            if tipo in ("FACTURA", "BL"):
                errores_criticos.append(f"{tipo}: {error}")
            continue

        admin.table("documentos_extraidos").update({
            "contenido_json": modelo.model_dump(mode="json"),
            "metodo_extraccion": metodo_extraccion,
            "procesado": True,
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


@app.post("/despachos", response_model=DespachoOut)
def crear_despacho(datos: DespachoCreate, usuario: UsuarioAutenticado = Depends(get_current_user)) -> dict:
    admin = get_supabase_admin_client()
    fila = {
        "numero_despacho": datos.numero_despacho,
        "cliente": datos.cliente,
        "creado_por": usuario.id,
    }
    respuesta = admin.table("despachos").insert(fila).execute()
    return respuesta.data[0]


@app.get("/despachos", response_model=list[DespachoOut])
def listar_despachos(
    estado: str | None = None, usuario: UsuarioAutenticado = Depends(get_current_user)
) -> list[dict]:
    admin = get_supabase_admin_client()
    consulta = admin.table("despachos").select("*").order("fecha_creacion", desc=True)
    if estado:
        consulta = consulta.eq("estado", estado)
    return consulta.execute().data or []


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
def obtener_despacho(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)) -> dict:
    admin = get_supabase_admin_client()
    return _armar_detalle_despacho(admin, id_despacho)


@app.get("/despachos/{id_despacho}/exportar-excel")
def exportar_despacho_excel(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)) -> Response:
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
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)
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
    usuario: UsuarioAutenticado = Depends(get_current_user),
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
    usuario: UsuarioAutenticado = Depends(get_current_user),
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

    El tipo real del archivo (PDF/JPG/PNG/WEBP) se detecta por su firma
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

    fila = {
        "id_despacho": id_despacho,
        "tipo_documento": tipo_documento,
        "contenido_json": {},
        "url_pdf_storage": path_storage,
        "metodo_extraccion": None,
        "procesado": False,
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
    usuario: UsuarioAutenticado = Depends(get_current_user),
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


@app.post("/despachos/{id_despacho}/validar", response_model=list[ResultadoValidacionOut])
def validar_despacho(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)) -> list[dict]:
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)
    resultados = _ejecutar_validacion(admin, id_despacho)
    return [r.model_dump() for r in resultados]


@app.post("/despachos/{id_despacho}/clasificar", response_model=PropuestaClasificacionOut)
def clasificar_despacho(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)) -> dict:
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)
    propuesta = _ejecutar_clasificacion(admin, id_despacho)
    return propuesta.model_dump()


@app.post("/despachos/{id_despacho}/generar-borrador", response_model=BorradorCorreoOut)
def generar_borrador_despacho(
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)
) -> dict:
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)
    return _ejecutar_generacion_borrador(admin, id_despacho)


@app.patch("/borradores/{id_borrador}", response_model=BorradorCorreoOut)
def editar_borrador(
    id_borrador: str,
    datos: ActualizarBorradorRequest,
    usuario: UsuarioAutenticado = Depends(get_current_user),
) -> dict:
    cliente_usuario = get_supabase_user_client(usuario.access_token)
    actualizado = actualizar_borrador_editado(cliente_usuario, id_borrador, datos.cuerpo_editado, usuario.id)
    return actualizado


@app.post("/despachos/{id_despacho}/decision", response_model=HistorialClasificacionOut)
def registrar_decision(
    id_despacho: str,
    datos: DecisionRequest,
    usuario: UsuarioAutenticado = Depends(get_current_user),
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
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)
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
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)
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
def listar_reglas_validacion(usuario: UsuarioAutenticado = Depends(get_current_user)) -> list[dict]:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    return admin.table("reglas_validacion").select("*").order("nombre").execute().data or []


@app.post("/admin/reglas-validacion", response_model=ReglaValidacionOut)
def crear_regla_validacion(
    datos: ReglaValidacionUpsert, usuario: UsuarioAutenticado = Depends(get_current_user)
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
    id_regla: str, datos: ReglaValidacionUpsert, usuario: UsuarioAutenticado = Depends(get_current_user)
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
    id_regla: str, usuario: UsuarioAutenticado = Depends(get_current_user)
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
def listar_cargos_especiales(usuario: UsuarioAutenticado = Depends(get_current_user)) -> list[dict]:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    return admin.table("cargos_especiales_arancel").select("*").order("subpartida").execute().data or []


@app.post("/admin/cargos-especiales-arancel", response_model=CargoEspecialArancelOut)
def crear_cargo_especial(
    datos: CargoEspecialArancelUpsert, usuario: UsuarioAutenticado = Depends(get_current_user)
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
    id_cargo: str, datos: CargoEspecialArancelUpsert, usuario: UsuarioAutenticado = Depends(get_current_user)
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
    id_cargo: str, usuario: UsuarioAutenticado = Depends(get_current_user)
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
def listar_usuarios(usuario: UsuarioAutenticado = Depends(get_current_user)) -> list[dict]:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    perfiles = admin.table("perfiles_especialista").select("*").order("creado_en").execute().data or []
    emails_por_id = {u.id: u.email for u in admin.auth.admin.list_users()}
    return [{**perfil, "email": emails_por_id.get(perfil["id"])} for perfil in perfiles]


@app.post("/admin/usuarios", response_model=UsuarioOut)
def crear_usuario(datos: UsuarioCreate, usuario: UsuarioAutenticado = Depends(get_current_user)) -> dict:
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
        {"nombre_completo": datos.nombre_completo, "rol": datos.rol}
    ).eq("id", id_usuario).execute()

    return {**_obtener_perfil_o_404(admin, id_usuario), "email": datos.email}


@app.put("/admin/usuarios/{id_usuario}", response_model=UsuarioOut)
def actualizar_usuario(
    id_usuario: str, datos: UsuarioUpdate, usuario: UsuarioAutenticado = Depends(get_current_user)
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
        {"nombre_completo": datos.nombre_completo, "rol": datos.rol, "activo": datos.activo}
    ).eq("id", id_usuario).execute()

    perfil_actualizado = _obtener_perfil_o_404(admin, id_usuario)
    email = next((u.email for u in admin.auth.admin.list_users() if u.id == id_usuario), None)
    return {**perfil_actualizado, "email": email}


@app.delete("/admin/usuarios/{id_usuario}")
def eliminar_usuario(id_usuario: str, usuario: UsuarioAutenticado = Depends(get_current_user)) -> dict:
    _requiere_rol(usuario, set())
    admin = get_supabase_admin_client()
    perfil = _obtener_perfil_o_404(admin, id_usuario)
    _verificar_no_es_ultimo_admin(admin, perfil)

    try:
        admin.auth.admin.delete_user(id_usuario)  # cascada: borra tambien perfiles_especialista
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"No se pudo eliminar el usuario: {error}") from error

    return {"status": "ok"}
