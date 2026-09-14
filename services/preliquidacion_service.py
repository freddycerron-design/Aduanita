"""
Calculo de los tributos de importacion de un despacho (Ad Valorem, IGV,
IPM, antidumping y derecho especifico) a partir de la subpartida ya
determinada por el clasificador.

Formula estandar SUNAT usada aqui:

    Ad Valorem   = Valor_CIF * (tasa_ad_valorem / 100)
    Base_IGV_IPM = Valor_CIF + Ad_Valorem + Derecho_especifico
    IGV          = Base_IGV_IPM * 16%
    IPM          = Base_IGV_IPM * 2%
    Total        = Ad_Valorem + IGV + IPM + Antidumping + Derecho_especifico

Nota: el antidumping NO forma parte de la base de IGV/IPM (se suma
directo al total). No se aplica tipo de cambio -- todo queda en la
moneda del Valor CIF (normalmente USD), igual que el resto de montos que
ya maneja la app (monto_total de factura, valor_asegurado del seguro).
Antidumping y derecho especifico no tienen una fuente oficial CSV/API
consolidada (son resoluciones puntuales de INDECOPI/MEF) -- se cargan a
mano via cargos_especiales_arancel (ver app/main.py, CRUD de ADMIN) y
pueden sobreescribirse por despacho al calcular.
"""
from __future__ import annotations

from pydantic import BaseModel

TASA_IGV = 0.16
TASA_IPM = 0.02


class PreliquidacionCalculada(BaseModel):
    """Resultado del calculo, listo para persistir en la tabla
    `preliquidaciones` (ver app/main.py::calcular_preliquidacion)."""

    valor_cif: float
    ad_valorem_tasa: float
    ad_valorem_monto: float
    base_igv_ipm: float
    igv_monto: float
    ipm_monto: float
    antidumping_monto: float
    derecho_especifico_monto: float
    total_tributos: float


def calcular_preliquidacion(
    valor_cif: float,
    ad_valorem_tasa: float,
    antidumping_monto: float = 0,
    derecho_especifico_monto: float = 0,
) -> PreliquidacionCalculada:
    """Aplica la formula de tributos descrita en el docstring del modulo.
    Funcion pura (sin llamadas a Supabase/Gemini) para que sea facil de
    verificar con casos de prueba conocidos."""
    ad_valorem_monto = valor_cif * (ad_valorem_tasa / 100)
    base_igv_ipm = valor_cif + ad_valorem_monto + derecho_especifico_monto
    igv_monto = base_igv_ipm * TASA_IGV
    ipm_monto = base_igv_ipm * TASA_IPM
    total_tributos = ad_valorem_monto + igv_monto + ipm_monto + antidumping_monto + derecho_especifico_monto

    return PreliquidacionCalculada(
        valor_cif=valor_cif,
        ad_valorem_tasa=ad_valorem_tasa,
        ad_valorem_monto=ad_valorem_monto,
        base_igv_ipm=base_igv_ipm,
        igv_monto=igv_monto,
        ipm_monto=ipm_monto,
        antidumping_monto=antidumping_monto,
        derecho_especifico_monto=derecho_especifico_monto,
        total_tributos=total_tributos,
    )
