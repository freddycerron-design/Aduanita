"""
Tipo de cambio del dolar publicado por SUNAT, guardado por fecha en la
tabla `tipos_cambio` (ver database/schema.sql, seccion 18).

Fuente: https://www.sunat.gob.pe/a/txt/tipoCambio.txt, un archivo publico
de SUNAT con el tipo de cambio del dia en una linea `dd/mm/aaaa|compra|venta|`.
La consulta mensual de e-consulta.sunat.gob.pe/cl-at-ittipcam no se usa:
su listado exige un token de reCAPTCHA v3 (sin el devuelve una lista
vacia). Como el archivo solo trae el dia actual, el historico se arma dia
a dia en la tabla, y un ADMIN puede cargar o corregir fechas a mano.

La fecha "de hoy" es la de Lima (UTC-5, sin horario de verano): el servidor
de Render corre en UTC y despues de las 19:00 de Lima ya seria el dia
siguiente.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import httpx
from pydantic import BaseModel
from supabase import Client

URL_TIPO_CAMBIO_SUNAT = "https://www.sunat.gob.pe/a/txt/tipoCambio.txt"
TIMEOUT_SEGUNDOS = 15
ZONA_LIMA = timezone(timedelta(hours=-5))


class TipoCambioSunatNoDisponibleError(Exception):
    """SUNAT no respondio o el archivo no tiene el formato esperado."""


class TipoCambioDia(BaseModel):
    fecha: date
    compra: float
    venta: float


def hoy_lima() -> date:
    return datetime.now(ZONA_LIMA).date()


def consultar_tipo_cambio_sunat() -> TipoCambioDia:
    """Lee el tipo de cambio que SUNAT publica hoy. La fecha es la que trae
    el archivo (puede no ser hoy, p.ej. temprano antes de la publicacion)."""
    try:
        respuesta = httpx.get(
            URL_TIPO_CAMBIO_SUNAT,
            timeout=TIMEOUT_SEGUNDOS,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Aduafy)"},
        )
        respuesta.raise_for_status()
    except httpx.HTTPError as error:
        raise TipoCambioSunatNoDisponibleError(f"No se pudo consultar el tipo de cambio en SUNAT: {error}") from error

    partes = [p.strip() for p in respuesta.text.strip().split("|")]
    try:
        fecha = datetime.strptime(partes[0], "%d/%m/%Y").date()
        return TipoCambioDia(fecha=fecha, compra=float(partes[1]), venta=float(partes[2]))
    except (IndexError, ValueError) as error:
        raise TipoCambioSunatNoDisponibleError(
            f"SUNAT respondió con un formato inesperado: {respuesta.text[:80]!r}"
        ) from error


def guardar_tipo_cambio(
    admin: Client, tipo_cambio: TipoCambioDia, fuente: str, actualizado_por: str | None
) -> dict:
    respuesta = (
        admin.table("tipos_cambio")
        .upsert(
            {
                "fecha": tipo_cambio.fecha.isoformat(),
                "compra": tipo_cambio.compra,
                "venta": tipo_cambio.venta,
                "fuente": fuente,
                "actualizado_por": actualizado_por,
                "actualizado_en": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="fecha",
        )
        .execute()
    )
    return respuesta.data[0]


def sincronizar_tipo_cambio_sunat(admin: Client, actualizado_por: str | None = None) -> dict:
    """Trae el tipo de cambio del dia de SUNAT y lo guarda. No pisa una
    fecha que un ADMIN corrigio a mano (fuente MANUAL)."""
    del_dia = consultar_tipo_cambio_sunat()
    existente = (
        admin.table("tipos_cambio").select("*").eq("fecha", del_dia.fecha.isoformat()).execute().data
    )
    if existente and existente[0]["fuente"] == "MANUAL":
        return existente[0]
    return guardar_tipo_cambio(admin, del_dia, "SUNAT", actualizado_por)


def obtener_tipo_cambio_vigente(admin: Client, fecha: date | None = None) -> dict | None:
    """Tipo de cambio para `fecha` (por defecto hoy en Lima).

    1. Si la tabla ya tiene esa fecha, se usa.
    2. Si no y es hoy, se trae de SUNAT y se guarda.
    3. Si aun asi no esta (SUNAT caido, o todavia no publico el de hoy, o
       es una fecha pasada que nunca se guardo), se usa el ultimo
       publicado ANTES de esa fecha -- el mismo criterio de SUNAT para
       fines de semana y feriados. La fila devuelta trae su propia
       `fecha`, para mostrar de que dia es.

    None solo si la tabla esta vacia y SUNAT no responde.
    """
    fecha = fecha or hoy_lima()

    exacto = admin.table("tipos_cambio").select("*").eq("fecha", fecha.isoformat()).execute().data
    if exacto:
        return exacto[0]

    if fecha == hoy_lima():
        try:
            sincronizar_tipo_cambio_sunat(admin)
        except TipoCambioSunatNoDisponibleError:
            pass  # se cae al ultimo guardado

    anterior = (
        admin.table("tipos_cambio")
        .select("*")
        .lte("fecha", fecha.isoformat())
        .order("fecha", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return anterior[0] if anterior else None
