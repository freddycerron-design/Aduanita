"""
Clasificador arancelario asistido por IA: propone la subpartida nacional
(10 digitos, Arancel de Aduanas de Peru) para la mercancia de un
despacho, apoyandose en los antecedentes recuperados por `rag_service`.
"""
from __future__ import annotations

import json
import re
from typing import Literal

from google.genai import types
from pydantic import BaseModel, Field

from app.config import GEMINI_MODEL_TEXTO_Y_VISION, get_genai_client
from services.pdf_processor import FacturaItem
from services.rag_service import Antecedente

NivelConfianza = Literal["ALTA", "MEDIA", "BAJA"]

# Umbrales para derivar nivel_confianza (categorico) desde score_confianza
# (numerico 0-1). Se derivan en Python en vez de pedirle ambos campos a
# Gemini -- pedirle los dos por separado corria el riesgo de que se
# contradigan entre si (ej. score_confianza=0.55 pero nivel_confianza=ALTA).
UMBRAL_CONFIANZA_ALTA = 0.85
UMBRAL_CONFIANZA_MEDIA = 0.6


def _derivar_nivel_confianza(score: float) -> NivelConfianza:
    if score >= UMBRAL_CONFIANZA_ALTA:
        return "ALTA"
    if score >= UMBRAL_CONFIANZA_MEDIA:
        return "MEDIA"
    return "BAJA"


class _PropuestaClasificacionIA(BaseModel):
    """Shape que se le pide a Gemini -- `score_confianza` numerico en vez
    de la categoria `nivel_confianza` directamente (ver PropuestaClasificacion
    mas abajo, que se arma en `clasificar()` derivando la categoria de este
    score)."""

    subpartida_sugerida: str = Field(description="Subpartida nacional en formato NNNN.NN.NN.NN")
    score_confianza: float = Field(
        ge=0,
        le=1,
        description="Confianza propia en la clasificacion propuesta, de 0 (muy insegura) a 1 (muy segura)",
    )
    informacion_faltante_alert: list[str] = Field(
        default_factory=list,
        description="Datos tecnicos que faltan para confirmar la clasificacion (composicion, uso, material, funcion, etc.)",
    )
    sustento_legal_rgi: str = Field(
        description="Sustento legal citando la(s) Regla(s) General(es) de Interpretacion (RGI 1 a 6) aplicadas"
    )


class PropuestaClasificacion(BaseModel):
    """Propuesta final expuesta al resto del backend y al frontend.
    `nivel_confianza` NUNCA se le pide directamente a Gemini -- se deriva
    de `score_confianza` (ver `_derivar_nivel_confianza`) para que las dos
    senales de confianza nunca se contradigan entre si."""

    subpartida_sugerida: str
    score_confianza: float = Field(description="0 (muy insegura) a 1 (muy segura)")
    nivel_confianza: NivelConfianza
    informacion_faltante_alert: list[str] = Field(default_factory=list)
    sustento_legal_rgi: str


def _formatear_antecedentes(antecedentes: list[Antecedente]) -> str:
    """Renderiza los antecedentes como ejemplos few-shot en el prompt,
    ya vienen ordenados por score_ponderado desc (mayor peso a los
    marcados EDITADO / peso_prioridad alto)."""
    if not antecedentes:
        return "No hay antecedentes previos similares registrados en el sistema."

    bloques = []
    for a in antecedentes:
        origen = "correccion de un especialista" if a.tipo_accion == "EDITADO" else "aprobacion de un especialista"
        bloque = (
            f"- Mercancia: \"{a.descripcion_comercial}\"\n"
            f"  Subpartida asignada: {a.subpartida_final_humano} ({origen}, similitud {a.similitud:.0%})"
        )
        if a.motivo_modificacion:
            bloque += f"\n  Motivo de la correccion: {a.motivo_modificacion}"
        bloques.append(bloque)
    return "\n".join(bloques)


def _formatear_items(items: list[FacturaItem]) -> str:
    if not items:
        return "La factura no detalla items individuales."
    bloques = []
    for item in items:
        detalle = f"- {item.descripcion} (cantidad: {item.cantidad}"
        if item.unidad_medida:
            detalle += f" {item.unidad_medida}"
        if item.material_declarado:
            detalle += f", material declarado: {item.material_declarado}"
        detalle += ")"
        bloques.append(detalle)
    return "\n".join(bloques)


def construir_prompt_clasificacion(
    descripcion_mercancia: str,
    items_factura: list[FacturaItem],
    antecedentes: list[Antecedente],
) -> str:
    return (
        "Eres un agente de aduanas experto en clasificacion arancelaria bajo el Arancel de Aduanas de Peru "
        "(Sistema Armonizado, subpartida nacional de 10 digitos).\n\n"
        "Analiza la siguiente mercancia y propone la subpartida nacional mas adecuada, aplicando las Reglas "
        "Generales de Interpretacion (RGI 1 a 6) del Sistema Armonizado.\n\n"
        f"--- DESCRIPCION GENERAL DE LA MERCANCIA ---\n{descripcion_mercancia}\n\n"
        f"--- ITEMS DETALLADOS EN LA FACTURA ---\n{_formatear_items(items_factura)}\n\n"
        f"--- ANTECEDENTES DE CLASIFICACIONES SIMILARES YA VALIDADAS POR ESPECIALISTAS ---\n"
        f"(ordenados de mayor a menor relevancia; da mas peso a los que provienen de una correccion humana, "
        f"ya que corrigen un error previo de la IA)\n{_formatear_antecedentes(antecedentes)}\n\n"
        "Instrucciones:\n"
        "1. Si la informacion tecnica disponible (composicion, material, uso, funcion) no alcanza para "
        "confirmar la subpartida con certeza, dilo explicitamente en 'informacion_faltante_alert' listando "
        "que dato falta pedir al cliente.\n"
        "2. 'score_confianza' debe ser bajo (cercano a 0) si falta informacion tecnica relevante, medio "
        "(alrededor de 0.5-0.7) si hay ambiguedad razonable entre 2 subpartidas cercanas, y alto (cercano a 1) "
        "solo si la evidencia es clara.\n"
        "3. 'sustento_legal_rgi' debe citar la o las reglas generales de interpretacion aplicadas y una "
        "justificacion breve.\n"
        "4. Aun con informacion incompleta, siempre debes proponer la subpartida que consideres mas probable "
        "en 'subpartida_sugerida' (nunca la dejes vacia)."
    )


def _texto_a_json(respuesta_texto: str) -> dict:
    texto = respuesta_texto.strip()
    coincidencia = re.search(r"```(?:json)?\s*(.*?)```", texto, re.DOTALL)
    if coincidencia:
        texto = coincidencia.group(1).strip()
    return json.loads(texto)


def clasificar(
    descripcion_mercancia: str,
    items_factura: list[FacturaItem],
    antecedentes: list[Antecedente],
) -> PropuestaClasificacion:
    """Genera la propuesta de subpartida arancelaria con salida estructurada."""
    prompt = construir_prompt_clasificacion(descripcion_mercancia, items_factura, antecedentes)

    # Se usa response_json_schema (JSON Schema serializado) en vez del
    # antiguo response_schema (clase Pydantic directa): es el parametro
    # soportado por la version vigente del SDK (google-genai 2.20.0,
    # verificado agosto 2026). La respuesta llega como JSON en
    # response.text y se valida manualmente contra el schema Pydantic.
    cliente = get_genai_client()
    respuesta = cliente.models.generate_content(
        model=GEMINI_MODEL_TEXTO_Y_VISION,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=_PropuestaClasificacionIA.model_json_schema(),
        ),
    )

    datos = _texto_a_json(respuesta.text)
    propuesta_ia = _PropuestaClasificacionIA.model_validate(datos)
    return PropuestaClasificacion(
        subpartida_sugerida=propuesta_ia.subpartida_sugerida,
        score_confianza=propuesta_ia.score_confianza,
        nivel_confianza=_derivar_nivel_confianza(propuesta_ia.score_confianza),
        informacion_faltante_alert=propuesta_ia.informacion_faltante_alert,
        sustento_legal_rgi=propuesta_ia.sustento_legal_rgi,
    )
