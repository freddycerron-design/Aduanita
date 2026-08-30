"""
Servicio de RAG (Retrieval-Augmented Generation) sobre el historial de
clasificaciones arancelarias ya decididas por humanos.

Genera embeddings con Gemini (`text-embedding-004`, 768 dimensiones),
busca antecedentes semanticamente similares via el RPC
`match_antecedentes_aduaneros` de Supabase (que pondera la similitud por
`peso_prioridad`), y persiste el feedback humano (aprobacion o
correccion) que alimenta al RAG para futuras busquedas.
"""
from __future__ import annotations

import math
from typing import Literal

from google.genai import types
from pydantic import BaseModel
from supabase import Client

from app.config import EMBEDDING_DIMENSIONS, GEMINI_MODEL_EMBEDDINGS, get_genai_client

TipoAccion = Literal["APROBADO", "EDITADO"]

# peso_prioridad de cada tipo de accion humana: una correccion (EDITADO)
# es una senal mas fuerte para el RAG que una simple aprobacion pasiva.
PESO_PRIORIDAD_POR_ACCION: dict[TipoAccion, float] = {
    "APROBADO": 1.0,
    "EDITADO": 2.0,
}

CANTIDAD_ANTECEDENTES_DEFECTO = 5


class Antecedente(BaseModel):
    id: str
    descripcion_comercial: str
    atributos_json: dict
    subpartida_final_humano: str
    tipo_accion: TipoAccion
    motivo_modificacion: str | None
    peso_prioridad: float
    similitud: float
    score_ponderado: float


def generar_embedding(texto: str) -> list[float]:
    """Genera el embedding (768 dims) de un texto usando Gemini (gemini-embedding-001).

    El modelo emite 3072 dimensiones por defecto; se solicita el truncado
    a 768 (Matryoshka Representation Learning) via `output_dimensionality`
    para calzar con la columna `vector(768)` del schema. Google recomienda
    normalizar (L2) el vector resultante cuando se usa un truncado distinto
    al nativo, ya que el truncado no queda automaticamente normalizado.
    """
    cliente = get_genai_client()
    respuesta = cliente.models.embed_content(
        model=GEMINI_MODEL_EMBEDDINGS,
        contents=texto,
        config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSIONS),
    )
    valores = list(respuesta.embeddings[0].values)
    norma = math.sqrt(sum(v * v for v in valores))
    return [v / norma for v in valores] if norma > 0 else valores


def construir_texto_para_embedding(descripcion_comercial: str, atributos: dict) -> str:
    """Concatena la descripcion comercial con sus atributos clave=valor
    para dar contexto semantico rico al embedding (mejora la calidad de
    la busqueda de antecedentes frente a usar solo la descripcion)."""
    partes = [descripcion_comercial.strip()]
    for clave, valor in atributos.items():
        if valor not in (None, "", []):
            partes.append(f"{clave}: {valor}")
    return "\n".join(partes)


def buscar_antecedentes(
    supabase: Client,
    descripcion_comercial: str,
    atributos: dict,
    match_count: int = CANTIDAD_ANTECEDENTES_DEFECTO,
) -> list[Antecedente]:
    """Busca los antecedentes de clasificacion mas relevantes para una
    nueva mercancia, priorizando (via score_ponderado, ya calculado en el
    RPC) los antecedentes marcados como EDITADO o con peso_prioridad alto."""
    texto = construir_texto_para_embedding(descripcion_comercial, atributos)
    embedding = generar_embedding(texto)

    respuesta = supabase.rpc(
        "match_antecedentes_aduaneros",
        {"query_embedding": embedding, "match_count": match_count},
    ).execute()

    return [Antecedente.model_validate(fila) for fila in (respuesta.data or [])]


def guardar_feedback(
    supabase_usuario: Client,
    id_despacho: str,
    descripcion_comercial: str,
    atributos: dict,
    subpartida_sugerida_ia: str,
    subpartida_final_humano: str,
    tipo_accion: TipoAccion,
    aprobado_por: str,
    motivo_modificacion: str | None = None,
) -> dict:
    """Persiste la decision del especialista en `historial_clasificaciones`,
    alimentando el feedback loop del RAG.

    IMPORTANTE: `supabase_usuario` debe ser un cliente autenticado con el
    JWT del especialista (ver app.config.get_supabase_user_client), no el
    cliente de service_role, para que la politica RLS de insercion valide
    `auth.uid() = aprobado_por` y quede correctamente auditado quien tomo
    la decision.
    """
    if tipo_accion == "EDITADO" and not motivo_modificacion:
        raise ValueError("motivo_modificacion es obligatorio cuando tipo_accion es 'EDITADO'.")

    texto = construir_texto_para_embedding(descripcion_comercial, atributos)
    embedding = generar_embedding(texto)

    fila = {
        "id_despacho": id_despacho,
        "descripcion_comercial": descripcion_comercial,
        "atributos_json": atributos,
        "subpartida_sugerida_ia": subpartida_sugerida_ia,
        "subpartida_final_humano": subpartida_final_humano,
        "tipo_accion": tipo_accion,
        "motivo_modificacion": motivo_modificacion,
        "embedding": embedding,
        "peso_prioridad": PESO_PRIORIDAD_POR_ACCION[tipo_accion],
        "aprobado_por": aprobado_por,
    }

    respuesta = supabase_usuario.table("historial_clasificaciones").insert(fila).execute()
    return respuesta.data[0]
