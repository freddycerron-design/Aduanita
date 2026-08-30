"""
Backend FastAPI de AduANITA: expone el pipeline completo de revision
documental aduanera y clasificacion arancelaria asistida.

Orden tipico del pipeline para un despacho:
  1. POST /despachos                                -> crear despacho
  2. POST /despachos/{id}/documentos  (x4)           -> subir y extraer cada PDF
  3. POST /despachos/{id}/validar                    -> validaciones cruzadas
  4. POST /despachos/{id}/clasificar                 -> propuesta de subpartida (RAG + Gemini)
  5. POST /despachos/{id}/generar-borrador           -> borrador de correo
  6. (el especialista revisa en el dashboard)
  7. POST /despachos/{id}/decision                   -> aprobar/corregir -> feedback al RAG

Los pasos 3-5 tambien se pueden ejecutar de corrido con
POST /pipeline/{id}/ejecutar-completo.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client

from app.config import get_settings, get_supabase_admin_client, get_supabase_user_client
from services.email_draft_service import (
    DespachoInfo,
    actualizar_borrador_editado,
    generar_borrador,
    guardar_borrador,
)
from services.gemini_classifier import PropuestaClasificacion, clasificar
from services.pdf_processor import TIPO_A_SCHEMA, ExtraccionFallidaError, TipoDocumento, procesar_documento
from services.rag_service import buscar_antecedentes, guardar_feedback
from services.validation_engine import (
    ResultadoValidacion,
    ejecutar_validaciones,
    hay_informacion_suficiente_para_clasificar,
)

settings = get_settings()

app = FastAPI(
    title="AduANITA API",
    description="Automatizacion de revision documental aduanera y clasificacion arancelaria asistida.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
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
    access_token: str


def get_current_user(authorization: str = Header(...)) -> UsuarioAutenticado:
    """Valida el JWT de Supabase Auth enviado en el header Authorization
    (formato 'Bearer <token>') y devuelve el usuario autenticado."""
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

    return UsuarioAutenticado(id=resultado.user.id, email=resultado.user.email, access_token=token)


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
    metodo_extraccion: str
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


class ActualizarBorradorRequest(BaseModel):
    cuerpo_editado: str


class DecisionRequest(BaseModel):
    accion: Literal["APROBADO", "EDITADO"]
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
    peso_prioridad: float
    aprobado_por: str


class PipelineResultOut(BaseModel):
    validaciones: list[ResultadoValidacionOut]
    clasificacion: PropuestaClasificacionOut
    borrador: BorradorCorreoOut
    estado_final: str


# ---------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------

def _obtener_despacho_o_404(admin: Client, id_despacho: str) -> dict:
    respuesta = admin.table("despachos").select("*").eq("id", id_despacho).execute()
    if not respuesta.data:
        raise HTTPException(status_code=404, detail=f"No existe un despacho con id {id_despacho}.")
    return respuesta.data[0]


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
    validaciones y en la clasificacion sin volver a llamar a Gemini."""
    documentos: dict[TipoDocumento, BaseModel] = {}
    for fila in filas:
        tipo: TipoDocumento = fila["tipo_documento"]
        schema = TIPO_A_SCHEMA[tipo]
        documentos[tipo] = schema.model_validate(fila["contenido_json"])
    return documentos


def _obtener_validaciones(admin: Client, id_despacho: str) -> list[ResultadoValidacion]:
    respuesta = (
        admin.table("resultados_validacion").select("*").eq("id_despacho", id_despacho).execute()
    )
    return [ResultadoValidacion.model_validate(fila) for fila in (respuesta.data or [])]


def _ejecutar_validacion(admin: Client, id_despacho: str) -> list[ResultadoValidacion]:
    filas = _obtener_documentos_extraidos(admin, id_despacho)
    documentos = _documentos_a_modelos(filas)

    if "FACTURA" not in documentos or "BL" not in documentos:
        raise HTTPException(
            status_code=400,
            detail="Se requiere al menos la Factura y el BL cargados para poder ejecutar las validaciones.",
        )

    resultados = ejecutar_validaciones(documentos)

    # Se limpian los resultados previos para evitar duplicados si el
    # especialista vuelve a correr la validacion (p.ej. tras corregir un PDF).
    admin.table("resultados_validacion").delete().eq("id_despacho", id_despacho).execute()
    filas_insertar = [
        {"id_despacho": id_despacho, **r.model_dump()} for r in resultados
    ]
    admin.table("resultados_validacion").insert(filas_insertar).execute()

    hay_alertas = any(r.severidad == "ALTA" for r in resultados)
    _actualizar_estado_despacho(admin, id_despacho, "VALIDADO_CON_ALERTAS" if hay_alertas else "VALIDADO_OK")

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
    propuesta = clasificar(factura.descripcion_mercancia, factura.items, antecedentes)

    _cache_clasificaciones[id_despacho] = propuesta
    _cache_info_suficiente[id_despacho] = info_suficiente
    _actualizar_estado_despacho(admin, id_despacho, "CLASIFICADO_IA")

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


@app.get("/despachos/{id_despacho}", response_model=DespachoDetalleOut)
def obtener_despacho(id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)) -> dict:
    admin = get_supabase_admin_client()
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

    return {
        "despacho": despacho,
        "documentos": documentos,
        "validaciones": validaciones,
        "clasificacion": clasificacion,
        "borrador": borrador,
    }


@app.post("/despachos/{id_despacho}/documentos", response_model=DocumentoExtraidoOut)
def subir_documento(
    id_despacho: str,
    tipo_documento: TipoDocumento = Form(...),
    archivo: UploadFile = File(...),
    usuario: UsuarioAutenticado = Depends(get_current_user),
) -> dict:
    admin = get_supabase_admin_client()
    despacho = _obtener_despacho_o_404(admin, id_despacho)

    if tipo_documento not in TIPO_A_SCHEMA:
        raise HTTPException(status_code=400, detail=f"tipo_documento invalido: {tipo_documento}")

    pdf_bytes = archivo.file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="El archivo subido esta vacio.")

    try:
        modelo, metodo_extraccion = procesar_documento(pdf_bytes, tipo_documento)
    except ExtraccionFallidaError as error:
        _actualizar_estado_despacho(admin, id_despacho, "ERROR")
        raise HTTPException(status_code=422, detail=str(error)) from error

    path_storage = f"{id_despacho}/{tipo_documento}.pdf"
    admin.storage.from_(settings.supabase_storage_bucket).upload(
        path_storage, pdf_bytes, {"content-type": "application/pdf", "upsert": "true"}
    )

    fila = {
        "id_despacho": id_despacho,
        "tipo_documento": tipo_documento,
        "contenido_json": modelo.model_dump(mode="json"),
        "url_pdf_storage": path_storage,
        "metodo_extraccion": metodo_extraccion,
    }
    respuesta = admin.table("documentos_extraidos").upsert(
        fila, on_conflict="id_despacho,tipo_documento"
    ).execute()

    if despacho["estado"] == "PENDIENTE_DOCUMENTOS":
        _actualizar_estado_despacho(admin, id_despacho, "EXTRAYENDO")

    return respuesta.data[0]


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
    admin = get_supabase_admin_client()
    _obtener_despacho_o_404(admin, id_despacho)

    if datos.accion == "EDITADO" and not datos.motivo_modificacion:
        raise HTTPException(status_code=400, detail="motivo_modificacion es obligatorio cuando accion='EDITADO'.")

    cliente_usuario = get_supabase_user_client(usuario.access_token)
    fila_creada = guardar_feedback(
        cliente_usuario,
        id_despacho=id_despacho,
        descripcion_comercial=datos.descripcion_comercial,
        atributos=datos.atributos,
        subpartida_sugerida_ia=datos.subpartida_sugerida_ia,
        subpartida_final_humano=datos.subpartida_final,
        tipo_accion=datos.accion,
        aprobado_por=usuario.id,
        motivo_modificacion=datos.motivo_modificacion,
    )

    _actualizar_estado_despacho(admin, id_despacho, "APROBADO" if datos.accion == "APROBADO" else "CORREGIDO")
    _cache_clasificaciones.pop(id_despacho, None)
    _cache_info_suficiente.pop(id_despacho, None)

    return fila_creada


@app.post("/pipeline/{id_despacho}/ejecutar-completo", response_model=PipelineResultOut)
def ejecutar_pipeline_completo(
    id_despacho: str, usuario: UsuarioAutenticado = Depends(get_current_user)
) -> dict:
    """Encadena validar -> clasificar -> generar-borrador en una sola
    llamada, para usar despues de subir los 4 documentos del despacho."""
    admin = get_supabase_admin_client()
    despacho = _obtener_despacho_o_404(admin, id_despacho)

    validaciones = _ejecutar_validacion(admin, id_despacho)
    clasificacion = _ejecutar_clasificacion(admin, id_despacho)
    borrador = _ejecutar_generacion_borrador(admin, id_despacho)

    despacho_actualizado = _obtener_despacho_o_404(admin, id_despacho)

    return {
        "validaciones": [v.model_dump() for v in validaciones],
        "clasificacion": clasificacion.model_dump(),
        "borrador": borrador,
        "estado_final": despacho_actualizado["estado"],
    }
