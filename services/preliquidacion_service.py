"""
Calculo de los tributos de importacion de un despacho (Ad Valorem, ISC,
IGV, IPM, antidumping y derecho especifico) a partir de la subpartida ya
determinada por el clasificador.

Formula estandar SUNAT usada aqui:

    Ad Valorem   = Valor_CIF * tasa_ad_valorem
    ISC          = (Valor_CIF + Ad_Valorem) * tasa_isc        (solo ISC al valor)
    Base_IGV_IPM = Valor_CIF + Ad_Valorem + ISC + Derecho_especifico
    IGV          = Base_IGV_IPM * tasa_igv
    IPM          = Base_IGV_IPM * tasa_ipm
    Total        = Ad_Valorem + ISC + IGV + IPM + Antidumping + Derecho_especifico

Las tasas NO son fijas: el endpoint las lee en vivo de SUNAT para la
subpartida (ver app/main.py::_tasas_para_subpartida). Asi se respetan las
exoneraciones de IGV/IPM (Apendice I de la Ley del IGV: SUNAT informa 0%),
el ISC de cada subpartida y el ad valorem vigente (el del arancel 2022
cargado puede estar desactualizado). Las constantes de abajo son solo el
respaldo cuando SUNAT no responde.

Nota: el antidumping NO forma parte de la base de IGV/IPM (se suma
directo al total). El calculo queda en la moneda del Valor CIF
(normalmente USD); la conversion a soles es aparte: el endpoint guarda en
el snapshot el tipo de cambio venta SUNAT del dia (ver
services/tipo_cambio_service.py) y el frontend muestra cada monto por ese
factor.
Antidumping y derecho especifico no tienen una fuente oficial CSV/API
consolidada (son resoluciones puntuales de INDECOPI/MEF) -- se cargan a
mano via cargos_especiales_arancel (ver app/main.py, CRUD de ADMIN) y
pueden sobreescribirse por despacho al calcular.
"""
from __future__ import annotations

from pydantic import BaseModel

# Respaldo si SUNAT no responde, en %. Son las tasas generales que SUNAT
# informaba para una subpartida sin exoneracion en octubre 2026 (IGV 15.5%
# + IPM 2.5% = 18%); si cambian, la consulta en vivo ya trae las nuevas.
TASA_IGV_GENERAL = 15.5
TASA_IPM_GENERAL = 2.5


class PreliquidacionCalculada(BaseModel):
    """Resultado del calculo, listo para persistir en la tabla
    `preliquidaciones` (ver app/main.py::calcular_preliquidacion)."""

    valor_cif: float
    ad_valorem_tasa: float
    ad_valorem_monto: float
    isc_tasa: float
    isc_monto: float
    base_igv_ipm: float
    igv_tasa: float
    igv_monto: float
    ipm_tasa: float
    ipm_monto: float
    antidumping_monto: float
    derecho_especifico_monto: float
    total_tributos: float


def calcular_preliquidacion(
    valor_cif: float,
    ad_valorem_tasa: float,
    igv_tasa: float = TASA_IGV_GENERAL,
    ipm_tasa: float = TASA_IPM_GENERAL,
    isc_tasa: float = 0,
    antidumping_monto: float = 0,
    derecho_especifico_monto: float = 0,
) -> PreliquidacionCalculada:
    """Aplica la formula del docstring del modulo. Tasas en % (15.5 =
    15.5%). Funcion pura (sin llamadas a Supabase/Gemini/SUNAT) para que
    sea facil de verificar con casos de prueba conocidos."""
    ad_valorem_monto = valor_cif * (ad_valorem_tasa / 100)
    isc_monto = (valor_cif + ad_valorem_monto) * (isc_tasa / 100)
    base_igv_ipm = valor_cif + ad_valorem_monto + isc_monto + derecho_especifico_monto
    igv_monto = base_igv_ipm * (igv_tasa / 100)
    ipm_monto = base_igv_ipm * (ipm_tasa / 100)
    total_tributos = (
        ad_valorem_monto + isc_monto + igv_monto + ipm_monto + antidumping_monto + derecho_especifico_monto
    )

    return PreliquidacionCalculada(
        valor_cif=valor_cif,
        ad_valorem_tasa=ad_valorem_tasa,
        ad_valorem_monto=ad_valorem_monto,
        isc_tasa=isc_tasa,
        isc_monto=isc_monto,
        base_igv_ipm=base_igv_ipm,
        igv_tasa=igv_tasa,
        igv_monto=igv_monto,
        ipm_tasa=ipm_tasa,
        ipm_monto=ipm_monto,
        antidumping_monto=antidumping_monto,
        derecho_especifico_monto=derecho_especifico_monto,
        total_tributos=total_tributos,
    )
