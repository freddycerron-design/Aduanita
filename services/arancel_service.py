"""
Busqueda de subpartidas candidatas contra el Arancel Nacional oficial
(tabla `partidas_arancelarias`, cargada por scripts/importar_arancel.py),
para dar al clasificador (services/gemini_classifier.py) un contexto
adicional al historial RAG propio del sistema.

Usa full-text search de Postgres (RPC `buscar_partidas_candidatas`, con
semantica OR -- ver el comentario de esa funcion en database/schema.sql)
en vez de embeddings: evita miles de llamadas a la API de Gemini para
indexar las ~8000 subpartidas nacionales.
"""
from __future__ import annotations

from pydantic import BaseModel
from supabase import Client

CANTIDAD_CANDIDATAS_DEFECTO = 8


class SubpartidaCandidata(BaseModel):
    codigo: str
    descripcion: str
    ad_valorem: float | None = None
    rank: float


def buscar_subpartidas_candidatas(
    supabase: Client, texto: str, limite: int = CANTIDAD_CANDIDATAS_DEFECTO
) -> list[SubpartidaCandidata]:
    """Devuelve las subpartidas del Arancel Nacional cuya descripcion
    oficial tiene mas palabras en comun con `texto` (tipicamente la
    descripcion de mercancia de la factura), ordenadas por relevancia."""
    respuesta = supabase.rpc(
        "buscar_partidas_candidatas", {"consulta": texto, "limite": limite}
    ).execute()
    return [SubpartidaCandidata.model_validate(fila) for fila in (respuesta.data or [])]
