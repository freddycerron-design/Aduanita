"""
Extraccion de datos estructurados desde los 4 tipos de documentos de un
despacho (FACTURA, SEGURO, SWIFT_BANCARIO, BL).

Estrategia de dos pasos:
1. PyMuPDF (fitz) extrae el texto crudo del PDF (rapido, gratis, sin
   llamadas a red). PyMuPDF NO hace NLP: solo entrega texto plano.
2. Gemini 1.5 Flash estructura ese texto en el schema Pydantic
   correspondiente (`response_schema`, salida JSON). Si el texto extraido
   es nulo o de mala calidad (tipico de un PDF escaneado sin capa de
   texto), se usa Gemini Vision sobre las paginas renderizadas como
   imagenes en su lugar.

Se usa Gemini para estructurar incluso el camino "texto" porque
PyMuPDF por si solo no entiende el contenido del documento; Gemini en
modo texto es mas barato/rapido que en modo vision, por eso se prefiere
cuando el texto disponible es de buena calidad.
"""
from __future__ import annotations

import json
import re
from datetime import date
from typing import Literal, Type

import pymupdf as fitz  # "fitz" es el alias historico de PyMuPDF; el import moderno es "pymupdf"
from google.genai import types
from pydantic import BaseModel, Field

from app.config import GEMINI_MODEL_TEXTO_Y_VISION, get_genai_client

TipoDocumento = Literal["FACTURA", "SEGURO", "SWIFT_BANCARIO", "BL"]

# Longitud minima de texto (en caracteres, ya sin espacios) para considerar
# que PyMuPDF logro extraer una capa de texto util del PDF.
UMBRAL_LONGITUD_TEXTO = 200
# Proporcion minima de caracteres alfanumericos sobre el total, para
# descartar texto "basura" (glifos mal decodificados de PDFs escaneados
# con una capa de OCR corrupta).
UMBRAL_RATIO_ALFANUMERICO = 0.5


class ExtraccionFallidaError(Exception):
    """Se lanza cuando ni el camino de texto ni el de vision logran producir
    una estructura valida contra el schema Pydantic esperado."""


# ---------------------------------------------------------------------
# Schemas Pydantic de cada tipo de documento
# ---------------------------------------------------------------------

class FacturaItem(BaseModel):
    """Una linea de detalle (item) dentro de la factura comercial."""

    descripcion: str = Field(description="Descripcion comercial del item tal como figura en la factura")
    cantidad: float
    unidad_medida: str | None = Field(default=None, description="Ej: PZA, KG, UND, CJA")
    precio_unitario: float | None = None
    material_declarado: str | None = Field(
        default=None,
        description="Material o composicion del item si el documento lo menciona (ej: 'acero inoxidable', 'algodon 100%')",
    )


class FacturaSchema(BaseModel):
    """Factura Comercial."""

    numero_factura: str
    fecha_emision: date | None = None
    vendedor: str
    comprador_consignatario: str
    incoterm: str | None = Field(default=None, description="Ej: FOB, CIF, EXW, CFR")
    moneda: str = Field(description="Codigo ISO de 3 letras, ej USD")
    monto_total: float
    peso_bruto_kg: float | None = None
    peso_neto_kg: float | None = None
    cantidad_bultos: int | None = None
    descripcion_mercancia: str = Field(description="Descripcion general de la mercancia facturada")
    items: list[FacturaItem] = Field(default_factory=list)


class SeguroSchema(BaseModel):
    """Poliza / aplicacion de seguro de la carga."""

    numero_poliza: str
    asegurado: str | None = None
    valor_asegurado: float
    moneda: str
    cobertura: str | None = Field(default=None, description="Tipo de cobertura, ej 'Todo riesgo'")
    referencia_factura: str | None = Field(
        default=None, description="Numero de factura referenciado en la poliza, si lo indica"
    )


class SwiftSchema(BaseModel):
    """Comprobante de transferencia bancaria internacional (SWIFT MT103 u similar)."""

    numero_operacion: str | None = None
    ordenante: str | None = None
    beneficiario: str | None = None
    monto: float
    moneda: str
    fecha_valor: date | None = None
    referencia_pago: str | None = Field(
        default=None, description="Referencia de pago que suele citar el numero de factura pagada"
    )


class BLSchema(BaseModel):
    """Bill of Lading / Conocimiento de Embarque."""

    numero_bl: str
    embarcador_shipper: str
    consignatario: str
    notify_party: str | None = None
    puerto_embarque: str
    puerto_descarga: str
    peso_bruto_kg: float | None = None
    cantidad_bultos: int | None = None
    incoterm: str | None = None
    descripcion_mercancia: str | None = None


TIPO_A_SCHEMA: dict[TipoDocumento, Type[BaseModel]] = {
    "FACTURA": FacturaSchema,
    "SEGURO": SeguroSchema,
    "SWIFT_BANCARIO": SwiftSchema,
    "BL": BLSchema,
}

_NOMBRE_DOCUMENTO_LEGIBLE: dict[TipoDocumento, str] = {
    "FACTURA": "Factura Comercial",
    "SEGURO": "Poliza / Aplicacion de Seguro de carga",
    "SWIFT_BANCARIO": "Comprobante de transferencia bancaria SWIFT",
    "BL": "Bill of Lading (conocimiento de embarque)",
}


# ---------------------------------------------------------------------
# Paso 1: extraccion cruda con PyMuPDF
# ---------------------------------------------------------------------

def extraer_texto_pymupdf(pdf_bytes: bytes) -> str:
    """Extrae y concatena el texto de todas las paginas de un PDF."""
    with fitz.open(stream=pdf_bytes, filetype="pdf") as documento:
        paginas = [pagina.get_text() for pagina in documento]
    return "\n".join(paginas)


def calidad_texto_suficiente(texto: str) -> bool:
    """Heuristica para decidir si el texto extraido por PyMuPDF alcanza
    para que Gemini lo estructure directamente, o si conviene irse por el
    camino de vision (PDF escaneado sin capa de texto util)."""
    texto_limpio = texto.strip()
    if len(texto_limpio) < UMBRAL_LONGITUD_TEXTO:
        return False

    caracteres_alfanumericos = sum(1 for c in texto_limpio if c.isalnum())
    ratio = caracteres_alfanumericos / len(texto_limpio)
    return ratio >= UMBRAL_RATIO_ALFANUMERICO


def pdf_a_imagenes(pdf_bytes: bytes, dpi: int = 200) -> list[bytes]:
    """Renderiza cada pagina del PDF como una imagen PNG (bytes), para
    enviarla a Gemini Vision cuando no hay capa de texto util."""
    imagenes: list[bytes] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as documento:
        for pagina in documento:
            pixmap = pagina.get_pixmap(dpi=dpi)
            imagenes.append(pixmap.tobytes("png"))
    return imagenes


# ---------------------------------------------------------------------
# Paso 2: estructuracion con Gemini (texto o vision)
# ---------------------------------------------------------------------

def _prompt_estructuracion(tipo_documento: TipoDocumento) -> str:
    nombre = _NOMBRE_DOCUMENTO_LEGIBLE[tipo_documento]
    return (
        f"Eres un asistente experto en documentacion de comercio exterior y aduanas de Peru. "
        f"El documento adjunto es un(a) {nombre}. Extrae unicamente los datos que figuren "
        f"explicitamente en el documento y devuelvelos en el formato JSON solicitado.\n\n"
        f"Reglas estrictas:\n"
        f"- No inventes ni infieras valores que no esten escritos en el documento.\n"
        f"- Si un dato no aparece, deja el campo correspondiente en null (no uses 0 ni cadenas vacias como relleno).\n"
        f"- Los montos y pesos deben ser numeros, sin simbolos de moneda ni separadores de miles.\n"
        f"- Usa el idioma y los terminos originales del documento para los campos de texto (nombres, direcciones, descripciones)."
    )


def _texto_a_json(respuesta_texto: str) -> dict:
    """Convierte la respuesta cruda de Gemini a un dict, tolerando que
    venga envuelta en un bloque de codigo markdown (```json ... ```)."""
    texto = respuesta_texto.strip()
    coincidencia = re.search(r"```(?:json)?\s*(.*?)```", texto, re.DOTALL)
    if coincidencia:
        texto = coincidencia.group(1).strip()
    return json.loads(texto)


def _generar_structured_output(contenidos: list, schema: Type[BaseModel]) -> dict:
    """Pide a Gemini una salida JSON ajustada al schema Pydantic dado.

    Se usa `response_json_schema` (JSON Schema ya serializado via
    `schema.model_json_schema()`) en vez del antiguo `response_schema`
    (clase Pydantic directa): se verifico contra la documentacion vigente
    del SDK (google-genai 2.20.0, agosto 2026) que ese es el parametro
    soportado actualmente; con el la respuesta llega solo como JSON en
    `response.text`, por eso se parsea manualmente en vez de depender de
    `response.parsed`.
    """
    cliente = get_genai_client()
    respuesta = cliente.models.generate_content(
        model=GEMINI_MODEL_TEXTO_Y_VISION,
        contents=contenidos,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
        ),
    )
    return _texto_a_json(respuesta.text)


def estructurar_texto_con_gemini(texto: str, tipo_documento: TipoDocumento) -> dict:
    """Estructura el texto plano (ya extraido por PyMuPDF) en el schema
    correspondiente, usando Gemini en modo solo-texto."""
    schema = TIPO_A_SCHEMA[tipo_documento]
    prompt = _prompt_estructuracion(tipo_documento)
    contenidos = [f"{prompt}\n\n--- TEXTO DEL DOCUMENTO ---\n{texto}"]
    return _generar_structured_output(contenidos, schema)


def extraer_con_gemini_vision(imagenes: list[bytes], tipo_documento: TipoDocumento) -> dict:
    """Estructura el documento a partir de sus paginas renderizadas como
    imagenes, usando Gemini Vision. Camino de respaldo para PDFs
    escaneados sin capa de texto util."""
    schema = TIPO_A_SCHEMA[tipo_documento]
    prompt = _prompt_estructuracion(tipo_documento)
    partes_imagen = [types.Part.from_bytes(data=img, mime_type="image/png") for img in imagenes]
    contenidos = [prompt, *partes_imagen]
    return _generar_structured_output(contenidos, schema)


# ---------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------

def procesar_documento(pdf_bytes: bytes, tipo_documento: TipoDocumento) -> tuple[BaseModel, str]:
    """Procesa un PDF de principio a fin y devuelve (objeto_pydantic_validado, metodo_extraccion).

    metodo_extraccion es 'PYMUPDF' si se pudo estructurar a partir del texto
    extraido por PyMuPDF, o 'GEMINI_VISION' si hubo que recurrir a las
    imagenes de las paginas (PDF escaneado o texto de mala calidad).
    """
    schema = TIPO_A_SCHEMA[tipo_documento]
    texto = extraer_texto_pymupdf(pdf_bytes)

    if calidad_texto_suficiente(texto):
        try:
            datos = estructurar_texto_con_gemini(texto, tipo_documento)
            return schema.model_validate(datos), "PYMUPDF"
        except Exception:
            # Si la estructuracion por texto falla (p.ej. Gemini no pudo
            # cumplir el schema con el texto disponible, o hubo un error
            # de red/API), se intenta el camino de vision como ultimo
            # recurso antes de fallar.
            pass

    try:
        imagenes = pdf_a_imagenes(pdf_bytes)
        datos = extraer_con_gemini_vision(imagenes, tipo_documento)
        return schema.model_validate(datos), "GEMINI_VISION"
    except Exception as error:
        # Cualquier falla en el ultimo recurso (schema invalido, error de
        # red/API de Gemini, JSON malformado, etc.) se reporta como una
        # extraccion fallida explicita en vez de propagar un error 500 crudo.
        raise ExtraccionFallidaError(
            f"No fue posible extraer un {tipo_documento} valido del PDF: {error}"
        ) from error
