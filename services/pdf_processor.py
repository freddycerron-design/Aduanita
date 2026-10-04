"""
Extraccion de datos estructurados desde los tipos de documentos de un
despacho (FACTURA, SEGURO, SWIFT_BANCARIO, BL, PACKING_LIST). Acepta
tanto PDF como imagenes (JPG/PNG/WEBP/HEIC) -- es comun que un especialista
solo tenga una foto del documento fisico, no un PDF.

El tipo real del archivo se detecta por su firma binaria ("magic bytes"),
nunca por la extension del nombre ni por el Content-Type que declare el
navegador (ambos pueden faltar o venir equivocados). Con eso se elige la
estrategia de extraccion:

1. **PDF**: PyMuPDF (fitz) extrae primero el texto crudo (rapido, gratis,
   sin llamadas a red -- PyMuPDF NO hace NLP, solo entrega texto plano).
   Si esa capa de texto es nula o de mala calidad (tipico de un PDF
   escaneado), se renderizan las paginas como imagenes y se usa Gemini
   Vision sobre ellas en su lugar.
2. **Imagen (JPG/PNG/WEBP/HEIC)**: no existe una capa de texto que extraer ni
   paginas que renderizar -- se va directo a Gemini Vision sobre el
   archivo tal cual fue subido.

En ambos casos la estructuracion final la hace Gemini contra el schema
Pydantic correspondiente (`response_json_schema`, salida JSON). Se
prefiere el modo texto sobre vision cuando hay un PDF con texto de buena
calidad porque es mas barato/rapido, pero el resultado final es identico
sin importar el camino tomado.

Lo que se le pide al modelo no es el schema del documento a secas, sino
un envoltorio que ademas lleva su propia autoevaluacion: que tan seguro
esta de lo que leyo (`score_confianza`) y que campos concretos no pudo
leer con seguridad (`campos_inciertos`). Eso es lo que permite mostrarle
al especialista donde mirar primero en vez de obligarlo a revisar los
cinco documentos campo por campo.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Literal, Type

import pymupdf as fitz  # "fitz" es el alias historico de PyMuPDF; el import moderno es "pymupdf"
from google.genai import types
from pydantic import BaseModel, Field, create_model

from app.config import generar_contenido_gemini

TipoDocumento = Literal["FACTURA", "SEGURO", "SWIFT_BANCARIO", "BL", "PACKING_LIST"]
NivelConfianza = Literal["ALTA", "MEDIA", "BAJA"]

# Longitud minima de texto (en caracteres, ya sin espacios) para considerar
# que PyMuPDF logro extraer una capa de texto util del PDF.
UMBRAL_LONGITUD_TEXTO = 200
# Proporcion minima de caracteres alfanumericos sobre el total, para
# descartar texto "basura" (glifos mal decodificados de PDFs escaneados
# con una capa de OCR corrupta).
UMBRAL_RATIO_ALFANUMERICO = 0.5

# Umbrales para derivar el nivel categorico (ALTA/MEDIA/BAJA) desde el
# score numerico 0-1 que el modelo reporta sobre si mismo. La categoria
# NUNCA se le pide al modelo junto con el score: pedirle los dos por
# separado corria el riesgo de que se contradigan entre si (ej.
# score_confianza=0.55 pero nivel_confianza=ALTA).
#
# Viven aca, en el modulo mas bajo de la cadena, porque los comparten la
# extraccion de documentos y el clasificador arancelario
# (services/gemini_classifier.py los importa de aca): las dos confianzas
# se muestran al especialista con las mismas tres etiquetas, asi que
# tienen que partir de los mismos cortes.
UMBRAL_CONFIANZA_ALTA = 0.85
UMBRAL_CONFIANZA_MEDIA = 0.6


def derivar_nivel_confianza(score: float) -> NivelConfianza:
    """Traduce un score 0-1 a la etiqueta que ve el especialista."""
    if score >= UMBRAL_CONFIANZA_ALTA:
        return "ALTA"
    if score >= UMBRAL_CONFIANZA_MEDIA:
        return "MEDIA"
    return "BAJA"


class ExtraccionFallidaError(Exception):
    """Se lanza cuando ni el camino de texto ni el de vision logran producir
    una estructura valida contra el schema Pydantic esperado."""


class TipoArchivoNoSoportadoError(Exception):
    """Se lanza cuando el archivo subido no es un PDF ni una imagen
    reconocible (JPG/PNG/WEBP/HEIC) segun su firma binaria."""


# Firmas binarias ("magic bytes") de los formatos soportados. Se comparan
# contra el inicio del archivo en vez de confiar en la extension del
# nombre o el Content-Type declarado por el navegador -- ninguno de los
# dos es confiable (un especialista puede subir una foto renombrada, o el
# navegador puede no declarar Content-Type en absoluto).
_FIRMA_PDF = b"%PDF-"
_FIRMA_JPEG = b"\xff\xd8\xff"
_FIRMA_PNG = b"\x89PNG\r\n\x1a\n"
_FIRMA_RIFF = b"RIFF"
_FIRMA_WEBP = b"WEBP"

# HEIC (el formato por defecto de la camara del iPhone) no tiene una firma
# al inicio del archivo como los demas: es un contenedor ISO-BMFF, donde
# los bytes 4-8 son la caja "ftyp" y los 8-12 la "marca" (brand) concreta.
# Se listan las marcas de la familia HEIF de imagen; "avif" queda afuera a
# proposito (es otro codec, no lo produce la camara del iPhone).
_FIRMA_FTYP = b"ftyp"
_MARCAS_HEIC = frozenset(
    {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs", b"mif1", b"msf1"}
)

EXTENSION_POR_MIME: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
}


def detectar_tipo_contenido(contenido: bytes) -> str:
    """Determina el tipo MIME real de un archivo a partir de sus primeros
    bytes. Devuelve uno de los tipos soportados (ver EXTENSION_POR_MIME) o
    lanza TipoArchivoNoSoportadoError si no coincide con ninguna firma
    conocida."""
    if contenido.startswith(_FIRMA_PDF):
        return "application/pdf"
    if contenido.startswith(_FIRMA_JPEG):
        return "image/jpeg"
    if contenido.startswith(_FIRMA_PNG):
        return "image/png"
    if contenido.startswith(_FIRMA_RIFF) and contenido[8:12] == _FIRMA_WEBP:
        return "image/webp"
    if contenido[4:8] == _FIRMA_FTYP and contenido[8:12] in _MARCAS_HEIC:
        return "image/heic"
    raise TipoArchivoNoSoportadoError(
        "El archivo no es un PDF ni una imagen reconocible (JPG/PNG/WEBP/HEIC)."
    )


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


class PackingListItem(BaseModel):
    """Una linea de detalle dentro del packing list."""

    descripcion: str
    cantidad: float
    unidad_medida: str | None = None
    peso_neto_kg: float | None = None
    peso_bruto_kg: float | None = None
    cantidad_bultos: int | None = None


class PackingListSchema(BaseModel):
    """Packing List / Lista de empaque."""

    numero_packing_list: str | None = None
    vendedor_exportador: str | None = None
    comprador_consignatario: str | None = None
    fecha_emision: date | None = None
    peso_bruto_kg: float | None = None
    peso_neto_kg: float | None = None
    cantidad_bultos: int | None = None
    tipo_embalaje: str | None = Field(default=None, description="Ej: cajas, pallets, bultos sueltos")
    marcas_numeros: str | None = Field(default=None, description="Shipping marks / marcas de los bultos")
    descripcion_mercancia: str | None = None
    items: list[PackingListItem] = Field(default_factory=list)


TIPO_A_SCHEMA: dict[TipoDocumento, Type[BaseModel]] = {
    "FACTURA": FacturaSchema,
    "SEGURO": SeguroSchema,
    "SWIFT_BANCARIO": SwiftSchema,
    "BL": BLSchema,
    "PACKING_LIST": PackingListSchema,
}

# Nombre legible de cada campo para la UI (el configurador de reglas los
# ofrece en una lista; el usuario no conoce los nombres tecnicos). Va aparte
# de los schemas a proposito: un `title` en el Field cambiaria el JSON
# Schema que se le manda a Gemini. Un campo sin entrada aca cae a
# `etiqueta_campo`, que lo humaniza a partir del nombre.
ETIQUETA_CAMPO: dict[str, str] = {
    "numero_factura": "Número de factura",
    "fecha_emision": "Fecha de emisión",
    "vendedor": "Vendedor",
    "comprador_consignatario": "Comprador / consignatario",
    "incoterm": "Incoterm",
    "moneda": "Moneda",
    "monto_total": "Monto total",
    "peso_bruto_kg": "Peso bruto (kg)",
    "peso_neto_kg": "Peso neto (kg)",
    "cantidad_bultos": "Cantidad de bultos",
    "descripcion_mercancia": "Descripción de la mercancía",
    "numero_poliza": "Número de póliza",
    "asegurado": "Asegurado",
    "valor_asegurado": "Valor asegurado",
    "cobertura": "Cobertura",
    "referencia_factura": "Factura referenciada",
    "numero_operacion": "Número de operación",
    "ordenante": "Ordenante",
    "beneficiario": "Beneficiario",
    "monto": "Monto transferido",
    "fecha_valor": "Fecha valor",
    "referencia_pago": "Referencia de pago",
    "numero_bl": "Número de BL",
    "embarcador_shipper": "Embarcador (shipper)",
    "consignatario": "Consignatario",
    "notify_party": "Notify party",
    "puerto_embarque": "Puerto de embarque",
    "puerto_descarga": "Puerto de descarga",
    "numero_packing_list": "Número de packing list",
    "vendedor_exportador": "Vendedor / exportador",
    "tipo_embalaje": "Tipo de embalaje",
    "marcas_numeros": "Marcas y números",
    "items": "Ítems",
    "descripcion": "Descripción",
    "cantidad": "Cantidad",
    "unidad_medida": "Unidad de medida",
    "precio_unitario": "Precio unitario",
    "material_declarado": "Material declarado",
}


def etiqueta_campo(nombre: str) -> str:
    return ETIQUETA_CAMPO.get(nombre) or nombre.replace("_", " ").capitalize()

_NOMBRE_DOCUMENTO_LEGIBLE: dict[TipoDocumento, str] = {
    "FACTURA": "Factura Comercial",
    "SEGURO": "Poliza / Aplicacion de Seguro de carga",
    "SWIFT_BANCARIO": "Comprobante de transferencia bancaria SWIFT",
    "BL": "Bill of Lading (conocimiento de embarque)",
    "PACKING_LIST": "Packing List / Lista de empaque",
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

@lru_cache(maxsize=None)
def _envoltorio_con_confianza(schema: Type[BaseModel]) -> Type[BaseModel]:
    """Arma (una sola vez por schema) el modelo que se le pide realmente a
    Gemini: los datos del documento envueltos junto a su autoevaluacion.

    Se construye dinamicamente en vez de escribir cinco envoltorios a mano
    para que agregar un tipo de documento nuevo a TIPO_A_SCHEMA siga sin
    requerir nada mas que la entrada en ese diccionario.
    """
    return create_model(
        f"Extraccion{schema.__name__}",
        datos=(schema, Field(description="Los datos leidos del documento")),
        score_confianza=(
            float,
            Field(
                ge=0,
                le=1,
                description=(
                    "Que tan seguro estas de tu propia lectura, de 0 (ilegible) "
                    "a 1 (nitido y sin ambiguedad)"
                ),
            ),
        ),
        campos_inciertos=(
            list[str],
            Field(
                default_factory=list,
                description="Nombres de los campos que no pudiste leer con seguridad",
            ),
        ),
    )


@dataclass(frozen=True)
class ResultadoExtraccion:
    """Todo lo que deja procesar un documento: los datos ya validados
    contra su schema, por que camino se obtuvieron, y que tan confiable es
    esa lectura segun el propio modelo."""

    datos: BaseModel
    metodo_extraccion: str
    score_confianza: float
    nivel_confianza: NivelConfianza
    campos_inciertos: list[str]


def _armar_resultado(bruto: dict, schema: Type[BaseModel], metodo: str) -> ResultadoExtraccion:
    """Valida el envoltorio crudo que devolvio Gemini y lo convierte en un
    ResultadoExtraccion.

    Los nombres de `campos_inciertos` se filtran contra los campos reales
    del schema: el modelo a veces devuelve un nombre que no existe (lo
    inventa o lo traduce), y guardarlo solo ensuciaria la base con marcas
    que el formulario nunca va a poder resaltar.
    """
    envoltorio = _envoltorio_con_confianza(schema).model_validate(bruto)
    campos_reales = set(schema.model_fields)
    return ResultadoExtraccion(
        datos=envoltorio.datos,
        metodo_extraccion=metodo,
        score_confianza=envoltorio.score_confianza,
        nivel_confianza=derivar_nivel_confianza(envoltorio.score_confianza),
        campos_inciertos=[c for c in envoltorio.campos_inciertos if c in campos_reales],
    )


def _prompt_estructuracion(tipo_documento: TipoDocumento) -> str:
    nombre = _NOMBRE_DOCUMENTO_LEGIBLE[tipo_documento]
    campos = ", ".join(TIPO_A_SCHEMA[tipo_documento].model_fields)
    return (
        f"Eres un asistente experto en documentacion de comercio exterior y aduanas de Peru. "
        f"El documento adjunto es un(a) {nombre}. Extrae unicamente los datos que figuren "
        f"explicitamente en el documento y devuelvelos en el formato JSON solicitado.\n\n"
        f"Reglas estrictas:\n"
        f"- No inventes ni infieras valores que no esten escritos en el documento.\n"
        f"- Si un dato no aparece, deja el campo correspondiente en null (no uses 0 ni cadenas vacias como relleno).\n"
        f"- Los montos y pesos deben ser numeros, sin simbolos de moneda ni separadores de miles.\n"
        f"- Usa el idioma y los terminos originales del documento para los campos de texto (nombres, direcciones, descripciones).\n\n"
        f"Ademas de los datos, evalua tu propia lectura -- un especialista la va a revisar y "
        f"necesita saber donde mirar primero:\n"
        f"- score_confianza: de 0 a 1. Bajalo si el documento esta borroso, cortado o mal escaneado, "
        f"o si tuviste que deducir algun dato; usa valores altos solo si todo se lee nitido.\n"
        f"- campos_inciertos: los campos que NO pudiste leer con seguridad, con estos nombres "
        f"exactos: {campos}. Que un dato no figure en el documento no es incertidumbre (ese va en "
        f"null y no se lista). Si leiste todo con seguridad, devuelve una lista vacia."
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
    respuesta = generar_contenido_gemini(
        contenidos,
        types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
        ),
    )
    return _texto_a_json(respuesta.text)


def estructurar_texto_con_gemini(texto: str, tipo_documento: TipoDocumento) -> dict:
    """Estructura el texto plano (ya extraido por PyMuPDF) en el schema
    correspondiente, usando Gemini en modo solo-texto. Devuelve el
    envoltorio crudo (datos + autoevaluacion), que `_armar_resultado`
    valida."""
    schema = _envoltorio_con_confianza(TIPO_A_SCHEMA[tipo_documento])
    prompt = _prompt_estructuracion(tipo_documento)
    contenidos = [f"{prompt}\n\n--- TEXTO DEL DOCUMENTO ---\n{texto}"]
    return _generar_structured_output(contenidos, schema)


def extraer_con_gemini_vision(imagenes: list[tuple[bytes, str]], tipo_documento: TipoDocumento) -> dict:
    """Estructura el documento a partir de una o mas imagenes (bytes,
    mime_type), usando Gemini Vision. Se usa tanto para las paginas
    renderizadas de un PDF escaneado (sin capa de texto util) como para un
    documento que ya llego como foto/imagen desde un principio. Devuelve
    el envoltorio crudo, igual que `estructurar_texto_con_gemini`."""
    schema = _envoltorio_con_confianza(TIPO_A_SCHEMA[tipo_documento])
    prompt = _prompt_estructuracion(tipo_documento)
    partes_imagen = [types.Part.from_bytes(data=img, mime_type=mime) for img, mime in imagenes]
    contenidos = [prompt, *partes_imagen]
    return _generar_structured_output(contenidos, schema)


# ---------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------

def procesar_documento(contenido: bytes, tipo_documento: TipoDocumento) -> ResultadoExtraccion:
    """Procesa un documento (PDF o imagen) de principio a fin y devuelve un
    `ResultadoExtraccion`: los datos ya validados contra su schema, el
    camino que se uso, y la autoevaluacion del modelo sobre su lectura.

    Primero se detecta el tipo real del archivo por su firma binaria (ver
    `detectar_tipo_contenido`), nunca por la extension del nombre, para
    elegir la estrategia adecuada:

    - PDF: intenta el camino de texto (PyMuPDF + Gemini texto) y cae a
      Gemini Vision sobre las paginas renderizadas si el texto es nulo o
      de mala calidad (PDF escaneado).
    - Imagen (JPG/PNG/WEBP/HEIC): va directo a Gemini Vision sobre el archivo
      tal cual, no hay capa de texto ni paginas que renderizar.

    metodo_extraccion es 'PYMUPDF' si se pudo estructurar a partir del
    texto extraido por PyMuPDF, o 'GEMINI_VISION' si hubo que recurrir a
    imagenes (PDF escaneado, texto de mala calidad, o el documento ya era
    una imagen desde un principio).
    """
    schema = TIPO_A_SCHEMA[tipo_documento]
    mime = detectar_tipo_contenido(contenido)

    if mime == "application/pdf":
        texto = extraer_texto_pymupdf(contenido)

        if calidad_texto_suficiente(texto):
            try:
                bruto = estructurar_texto_con_gemini(texto, tipo_documento)
                return _armar_resultado(bruto, schema, "PYMUPDF")
            except Exception:
                # Si la estructuracion por texto falla (p.ej. Gemini no pudo
                # cumplir el schema con el texto disponible, o hubo un error
                # de red/API), se intenta el camino de vision como ultimo
                # recurso antes de fallar.
                pass

        try:
            imagenes = [(img, "image/png") for img in pdf_a_imagenes(contenido)]
            bruto = extraer_con_gemini_vision(imagenes, tipo_documento)
            return _armar_resultado(bruto, schema, "GEMINI_VISION")
        except Exception as error:
            # Cualquier falla en el ultimo recurso (schema invalido, error de
            # red/API de Gemini, JSON malformado, etc.) se reporta como una
            # extraccion fallida explicita en vez de propagar un error 500 crudo.
            raise ExtraccionFallidaError(
                f"No fue posible extraer un {tipo_documento} valido del PDF: {error}"
            ) from error

    # Ya es una imagen (JPG/PNG/WEBP/HEIC): no hay capa de texto que intentar
    # primero, se estructura directo con Gemini Vision.
    try:
        bruto = extraer_con_gemini_vision([(contenido, mime)], tipo_documento)
        return _armar_resultado(bruto, schema, "GEMINI_VISION")
    except Exception as error:
        raise ExtraccionFallidaError(
            f"No fue posible extraer un {tipo_documento} valido de la imagen: {error}"
        ) from error
