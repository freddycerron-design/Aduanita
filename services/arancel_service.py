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

import re

from pydantic import BaseModel
from supabase import Client

CANTIDAD_CANDIDATAS_DEFECTO = 8
# Una consulta "de codigo" es solo digitos y puntos (ej. "9011", "9011.10",
# "9011.10.00.00"). Cualquier otra cosa se trata como busqueda por texto.
_RE_CODIGO = re.compile(r"^[\d.]+$")


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


def es_consulta_de_codigo(consulta: str) -> bool:
    """True si la consulta parece un codigo de subpartida (solo digitos y
    puntos) en vez de una descripcion de mercancia."""
    return bool(_RE_CODIGO.match(consulta.strip()))


def buscar_por_codigo(
    supabase: Client, codigo: str, limite: int = CANTIDAD_CANDIDATAS_DEFECTO
) -> list[SubpartidaCandidata]:
    """Busca subpartidas cuyo codigo empieza con `codigo` (busqueda por
    prefijo: "9011" devuelve todas las 9011.xx.xx.xx). Complementa la
    busqueda por texto, que no sirve cuando el usuario ya sabe el numero.

    `rank` se devuelve en 0 -- el concepto de relevancia del full-text no
    aplica aca, pero se mantiene el mismo modelo para que el frontend
    consuma un unico shape."""
    respuesta = (
        supabase.table("partidas_arancelarias")
        .select("codigo, descripcion, ad_valorem")
        .like("codigo", f"{codigo.strip()}%")
        .order("codigo")
        .limit(limite)
        .execute()
    )
    return [
        SubpartidaCandidata.model_validate({**fila, "rank": 0.0}) for fila in (respuesta.data or [])
    ]
