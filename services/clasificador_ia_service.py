"""
Chat "Clasificador con IA": clasificacion arancelaria conversacional.

El usuario describe la mercancia (texto, foto o documento) y el modelo,
actuando como un liquidador de aduanas peruano, hace las preguntas que
falten hasta poder proponer la subpartida nacional de 10 digitos.

Como funciona cada turno (sin estado en el servidor: el frontend manda
la conversacion completa cada vez):

1. Se arma el contexto del arancel: subpartidas REALES de
   `partidas_arancelarias` buscadas por texto (terminos que el modelo
   propuso en el turno anterior + lo que escribio el usuario) y por prefijo
   (partidas de 4-8 digitos que el modelo pidio explorar). El modelo solo
   puede elegir codigos de ese listado: asi no inventa subpartidas.
2. Se llama a Gemini con el system prompt (editable por un ADMIN, ver
   `obtener_system_prompt`) y una salida JSON estructurada: o una pregunta
   (con opciones de respuesta rapida) o la clasificacion final.
3. Si clasifico, se valida el codigo contra el arancel cargado y se leen
   en vivo de SUNAT los gravamenes vigentes (ad valorem, ISC, IGV, IPM).

Cada turno es una llamada a Gemini (cuota del plan gratuito).
"""
from __future__ import annotations

import base64
import json
import re
from typing import Literal

from google.genai import types
from pydantic import BaseModel, Field
from supabase import Client

from app.config import generar_contenido_gemini
from services.arancel_service import SubpartidaCandidata, buscar_por_codigo, buscar_subpartidas_candidatas
from services.pdf_processor import TipoArchivoNoSoportadoError, derivar_nivel_confianza, detectar_tipo_contenido
from services.sunat_arancel_service import SunatNoDisponibleError, consultar_medidas_sunat

CLAVE_SYSTEM_PROMPT = "clasificador_ia_system_prompt"
MAX_CANDIDATAS = 60
MAX_BYTES_ADJUNTO = 8 * 1024 * 1024
MIME_ADJUNTO_ADMITIDOS = {"application/pdf", "image/jpeg", "image/png", "image/webp"}

SYSTEM_PROMPT_PREDETERMINADO = """\
Eres un liquidador y especialista en clasificación arancelaria de mercancías del Perú, con años de experiencia ante SUNAT. Tu trabajo es determinar la subpartida nacional de 10 dígitos (formato NNNN.NN.NN.NN) de una mercancía, conversando con el usuario como lo haría un liquidador experto con su cliente.

MARCO NORMATIVO
- Arancel de Aduanas del Perú 2022 (D.S. N.° 404-2021-EF), basado en la Nomenclatura Común de los Países Miembros de la Comunidad Andina (NANDINA), que a su vez se basa en el Sistema Armonizado (SA) 2022 de la Organización Mundial de Aduanas.
- Las Reglas Generales para la Interpretación del Sistema Armonizado (RGI), aplicadas en orden:
  RGI 1: la clasificación se determina legalmente por los textos de las partidas y de las Notas de Sección o de Capítulo; los títulos de secciones y capítulos solo tienen valor indicativo.
  RGI 2 a): un artículo incompleto o sin terminar se clasifica como el artículo completo o terminado si presenta sus características esenciales; incluye el artículo desmontado o sin montar.
  RGI 2 b): la mención de una materia alcanza también a sus mezclas o asociaciones con otras materias; las mercancías de varias materias se clasifican según la RGI 3.
  RGI 3 a): la partida más específica tiene prioridad sobre la más genérica.
  RGI 3 b): mezclas, manufacturas de materias diferentes y juegos o surtidos acondicionados para la venta al por menor se clasifican por la materia o el artículo que les confiere el carácter esencial.
  RGI 3 c): si no se puede aplicar 3 a) ni 3 b), se clasifica en la última partida por orden de numeración entre las susceptibles de tenerse en cuenta.
  RGI 4: lo que no pueda clasificarse con las reglas anteriores va en la partida de los artículos con los que tenga mayor analogía.
  RGI 5: estuches y envases presentados con los artículos que contienen siguen su clasificación cuando son del tipo normalmente usado para ellos (salvo que confieran el carácter esencial al conjunto).
  RGI 6: la clasificación en subpartidas se determina por los textos de las subpartidas y sus notas, aplicando las reglas anteriores entre subpartidas del mismo nivel (mismo número de guiones).
- Las Notas Legales de Sección y de Capítulo, que son vinculantes, y como criterio de interpretación las Notas Explicativas del SA y los criterios y resoluciones de clasificación arancelaria de SUNAT.

CÓMO TRABAJAS
- Antes de clasificar, identifica lo que define la clasificación para ese tipo de mercancía: materia o composición (y sus porcentajes), función y uso principal, grado de elaboración o estado (fresco, congelado, seco, cocido, en bruto, semielaborado, terminado), forma de presentación (a granel, para la venta al por menor, en juego o surtido), características técnicas (potencia, capacidad, dimensiones, principio de funcionamiento) y si es una parte, un accesorio o un artículo completo.
- Si falta un dato que cambia la subpartida, PREGUNTA. Haz como máximo dos preguntas por turno, concretas y en lenguaje simple, y ofrece opciones de respuesta cuando sea posible (por ejemplo: "¿Está pulido o glaseado?" con opciones "Sí" / "No" / "No lo sé").
- No preguntes lo que ya se puede ver en la imagen o el documento adjunto, ni lo que no cambia la clasificación.
- Si el usuario no conoce un dato, aplica la regla que corresponda (normalmente la subpartida residual "Los demás") y dilo en la justificación.
- Cuando tengas la información suficiente, o después de cuatro o cinco intercambios, entrega la clasificación con la confianza que corresponda.

REGLAS ESTRICTAS
- Solo puedes proponer una subpartida que figure en el listado "SUBPARTIDAS DEL ARANCEL" que se te entrega en cada turno. Nunca inventes un código.
- Si en el listado no está la partida correcta, no clasifiques todavía: indica en "partidas_a_explorar" los códigos de 4 a 8 dígitos que quieres revisar (por ejemplo "1006" o "1006.30") y en "terminos_busqueda" palabras de la terminología arancelaria (por ejemplo "arroz semiblanqueado"), y haz una pregunta o explica que estás revisando el arancel.
- En la justificación cita las RGI y las notas aplicadas, y explica por qué descartas las subpartidas más cercanas.
- La confianza es un número de 0 a 1: alta solo si el texto de la subpartida describe claramente la mercancía y no quedan datos relevantes por confirmar.
- Responde siempre en español, con tono profesional y cercano. Tu clasificación es referencial: la responsabilidad final es del despachador de aduana.
"""


# ---------------------------------------------------------------------
# Modelos de entrada/salida
# ---------------------------------------------------------------------

class AdjuntoChat(BaseModel):
    nombre: str
    # Base64 sin el prefijo "data:...;base64,".
    contenido_base64: str


class MensajeChat(BaseModel):
    rol: Literal["usuario", "asistente"]
    texto: str = ""
    adjunto: AdjuntoChat | None = None


class ContextoChat(BaseModel):
    """Lo que el modelo pidio buscar en el turno anterior; el frontend lo
    devuelve tal cual en el siguiente turno."""

    terminos_busqueda: list[str] = Field(default_factory=list)
    partidas_a_explorar: list[str] = Field(default_factory=list)


class _Descartada(BaseModel):
    subpartida: str
    motivo: str


class _ClasificacionIA(BaseModel):
    subpartida: str = Field(description="Subpartida nacional de 10 digitos, formato NNNN.NN.NN.NN, del listado")
    titulo: str = Field(description="Nombre corto de la mercancia o de la subpartida, ej. 'Otros' o 'Arroz blanco'")
    score_confianza: float = Field(description="0 (muy insegura) a 1 (muy segura)")
    justificacion: str = Field(description="Por que corresponde esta subpartida, citando RGI y notas aplicadas")
    descartadas: list[_Descartada] = Field(
        default_factory=list, description="Subpartidas cercanas descartadas y por que"
    )


class _RespuestaIA(BaseModel):
    tipo: Literal["pregunta", "clasificacion"]
    mensaje: str = Field(description="Texto para el usuario: la pregunta, o un resumen breve de la clasificacion")
    opciones: list[str] = Field(
        default_factory=list, description="Respuestas rapidas sugeridas para la pregunta (0 a 4)"
    )
    terminos_busqueda: list[str] = Field(
        default_factory=list, description="Palabras de terminologia arancelaria para buscar en el arancel"
    )
    partidas_a_explorar: list[str] = Field(
        default_factory=list, description="Codigos de 4 a 8 digitos a revisar en el arancel, ej. '1006' o '1006.30'"
    )
    clasificacion: _ClasificacionIA | None = Field(default=None, description="Solo si tipo es 'clasificacion'")


class GravamenClasificacion(BaseModel):
    concepto: str
    valor: str


class ClasificacionChat(BaseModel):
    subpartida: str
    titulo: str
    descripcion_oficial: str | None
    existe_en_arancel: bool
    nivel_confianza: Literal["ALTA", "MEDIA", "BAJA"]
    score_confianza: float
    justificacion: str
    descartadas: list[_Descartada]
    # Ad valorem / ISC / IGV / IPM. fuente_tributos = SUNAT (en vivo) o
    # LOCAL (solo ad valorem del arancel 2022, SUNAT no respondio).
    tributos: list[GravamenClasificacion]
    fuente_tributos: Literal["SUNAT", "LOCAL"]


class RespuestaChat(BaseModel):
    tipo: Literal["pregunta", "clasificacion"]
    mensaje: str
    opciones: list[str]
    contexto: ContextoChat
    clasificacion: ClasificacionChat | None = None


class AdjuntoInvalidoError(Exception):
    pass


# ---------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------

def obtener_system_prompt(admin: Client) -> tuple[str, bool]:
    """(prompt vigente, es_predeterminado)."""
    filas = admin.table("parametros_sistema").select("valor").eq("clave", CLAVE_SYSTEM_PROMPT).execute().data
    if filas and filas[0]["valor"].strip():
        return filas[0]["valor"], False
    return SYSTEM_PROMPT_PREDETERMINADO, True


# ---------------------------------------------------------------------
# Contexto del arancel
# ---------------------------------------------------------------------

def _prefijo_con_puntos(codigo: str) -> str | None:
    """'1006' / '10.06' -> '1006'; '100630' -> '1006.30'; '10063090' ->
    '1006.30.90'. None si no son 4, 6 u 8 digitos."""
    digitos = re.sub(r"\D", "", codigo)
    if len(digitos) not in (4, 6, 8):
        return None
    partes = [digitos[:4]] + [digitos[i : i + 2] for i in range(4, len(digitos), 2)]
    return ".".join(partes)


def _candidatas(admin: Client, textos_usuario: list[str], contexto: ContextoChat) -> list[SubpartidaCandidata]:
    vistas: dict[str, SubpartidaCandidata] = {}

    for codigo in contexto.partidas_a_explorar[:6]:
        prefijo = _prefijo_con_puntos(codigo)
        if prefijo:
            for c in buscar_por_codigo(admin, prefijo, limite=40):
                vistas.setdefault(c.codigo, c)

    consulta = " ".join([*contexto.terminos_busqueda, *textos_usuario[-3:]]).strip()
    if consulta:
        for c in buscar_subpartidas_candidatas(admin, consulta[:500], limite=25):
            vistas.setdefault(c.codigo, c)

    return list(vistas.values())[:MAX_CANDIDATAS]


def _bloque_candidatas(candidatas: list[SubpartidaCandidata]) -> str:
    if not candidatas:
        return (
            "SUBPARTIDAS DEL ARANCEL: (todavía ninguna). Usa 'partidas_a_explorar' y 'terminos_busqueda' "
            "para pedir las que necesitas revisar; no clasifiques en este turno."
        )
    lineas = [f"{c.codigo} | {c.descripcion[:260]}" for c in sorted(candidatas, key=lambda c: c.codigo)]
    return "SUBPARTIDAS DEL ARANCEL (código | descripción oficial):\n" + "\n".join(lineas)


# ---------------------------------------------------------------------
# Conversacion -> Gemini
# ---------------------------------------------------------------------

def _parte_adjunto(adjunto: AdjuntoChat) -> types.Part:
    try:
        datos = base64.b64decode(adjunto.contenido_base64, validate=True)
    except (ValueError, TypeError) as error:
        raise AdjuntoInvalidoError(f"El archivo '{adjunto.nombre}' no se pudo leer.") from error
    if len(datos) > MAX_BYTES_ADJUNTO:
        raise AdjuntoInvalidoError(f"El archivo '{adjunto.nombre}' supera los 8 MB.")
    try:
        mime = detectar_tipo_contenido(datos)
    except TipoArchivoNoSoportadoError as error:
        raise AdjuntoInvalidoError(f"'{adjunto.nombre}': solo se admiten PDF, JPG, PNG o WEBP.") from error
    if mime not in MIME_ADJUNTO_ADMITIDOS:
        raise AdjuntoInvalidoError(f"'{adjunto.nombre}': solo se admiten PDF, JPG, PNG o WEBP.")
    return types.Part.from_bytes(data=datos, mime_type=mime)


def _contenidos(historial: list[MensajeChat], bloque_arancel: str) -> list[types.Content]:
    contenidos: list[types.Content] = []
    for indice, mensaje in enumerate(historial):
        partes: list[types.Part] = []
        if mensaje.adjunto is not None:
            partes.append(_parte_adjunto(mensaje.adjunto))
        texto = mensaje.texto.strip()
        # El listado del arancel va pegado al ultimo mensaje del usuario:
        # es contexto de ESTE turno, no algo que el usuario escribio.
        if indice == len(historial) - 1:
            texto = f"{texto}\n\n---\n{bloque_arancel}" if texto else bloque_arancel
        if texto:
            partes.append(types.Part.from_text(text=texto))
        if partes:
            contenidos.append(
                types.Content(role="user" if mensaje.rol == "usuario" else "model", parts=partes)
            )
    return contenidos


def _tributos(admin: Client, subpartida: str, ad_valorem_local: float | None) -> tuple[list[GravamenClasificacion], str]:
    conceptos = {
        "Ad Valorem": "Ad Valorem",
        "Impuesto Selectivo al Consumo": "ISC",
        "Impuesto General a las Ventas": "IGV",
        "Impuesto de Promoción Municipal": "IPM",
    }
    try:
        medidas = consultar_medidas_sunat(subpartida)
    except SunatNoDisponibleError:
        medidas = None
    if medidas is not None:
        valores = {g.concepto: g.valor for g in medidas.gravamenes}
        return (
            [GravamenClasificacion(concepto=corto, valor=valores.get(largo, "—")) for largo, corto in conceptos.items()],
            "SUNAT",
        )
    av = f"{ad_valorem_local:g}%" if ad_valorem_local is not None else "—"
    return [GravamenClasificacion(concepto="Ad Valorem", valor=av)], "LOCAL"


def conversar(admin: Client, historial: list[MensajeChat], contexto: ContextoChat) -> RespuestaChat:
    if not historial or historial[-1].rol != "usuario":
        raise ValueError("La conversación debe terminar con un mensaje del usuario.")

    system_prompt, _ = obtener_system_prompt(admin)
    textos_usuario = [m.texto for m in historial if m.rol == "usuario" and m.texto.strip()]
    candidatas = _candidatas(admin, textos_usuario, contexto)
    contenidos = _contenidos(historial, _bloque_candidatas(candidatas))

    respuesta = generar_contenido_gemini(
        contenidos,
        types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            response_json_schema=_RespuestaIA.model_json_schema(),
        ),
    )
    texto = (respuesta.text or "").strip()
    texto = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto)
    ia = _RespuestaIA.model_validate(json.loads(texto))

    nuevo_contexto = ContextoChat(
        terminos_busqueda=ia.terminos_busqueda or contexto.terminos_busqueda,
        partidas_a_explorar=ia.partidas_a_explorar or contexto.partidas_a_explorar,
    )

    if ia.tipo != "clasificacion" or ia.clasificacion is None:
        return RespuestaChat(tipo="pregunta", mensaje=ia.mensaje, opciones=ia.opciones[:4], contexto=nuevo_contexto)

    propuesta = ia.clasificacion
    codigo = propuesta.subpartida.strip()
    fila = admin.table("partidas_arancelarias").select("codigo, descripcion, ad_valorem").eq("codigo", codigo).execute().data
    score = max(0.0, min(1.0, propuesta.score_confianza))
    tributos, fuente = _tributos(admin, codigo, fila[0]["ad_valorem"] if fila else None) if fila else ([], "LOCAL")

    return RespuestaChat(
        tipo="clasificacion",
        mensaje=ia.mensaje,
        opciones=[],
        contexto=nuevo_contexto,
        clasificacion=ClasificacionChat(
            subpartida=codigo,
            titulo=propuesta.titulo,
            descripcion_oficial=fila[0]["descripcion"] if fila else None,
            existe_en_arancel=bool(fila),
            nivel_confianza=derivar_nivel_confianza(score),
            score_confianza=score,
            justificacion=propuesta.justificacion,
            descartadas=propuesta.descartadas,
            tributos=tributos,
            fuente_tributos=fuente,
        ),
    )
