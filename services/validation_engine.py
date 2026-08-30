"""
Motor de validaciones cruzadas entre los 4 documentos de un despacho.

Compara Factura, Poliza de Seguro, SWIFT bancario y BL entre si para
detectar discrepancias de peso, bultos, montos, consignatario e
Incoterm, devolviendo una lista de `ResultadoValidacion` persistible en
la tabla `resultados_validacion`.
"""
from __future__ import annotations

import unicodedata
from typing import Literal

from pydantic import BaseModel
from rapidfuzz import fuzz

from services.pdf_processor import BLSchema, FacturaSchema, SeguroSchema, SwiftSchema, TipoDocumento

Severidad = Literal["ALTA", "MEDIA", "NINGUNA"]

# Tolerancia maxima permitida (1%) para considerar iguales dos pesos que
# no coinciden exactamente (redondeos normales entre documentos).
TOLERANCIA_PESO = 0.01
# Umbral de similitud (0-1) por debajo del cual dos razones sociales se
# consideran distintas en el chequeo estricto de consignatario.
UMBRAL_SIMILITUD_CONSIGNATARIO = 0.9
# Diferencia relativa maxima tolerada entre valor asegurado y monto de
# factura antes de marcar la discrepancia como severidad ALTA en vez de MEDIA.
UMBRAL_DIFERENCIA_SEGURO = 0.30


class ResultadoValidacion(BaseModel):
    regla: str
    severidad: Severidad
    detalle: str
    valor_a: dict | None = None
    valor_b: dict | None = None


def _normalizar_razon_social(texto: str) -> str:
    """Normaliza una razon social para comparacion difusa: mayusculas, sin
    tildes y sin sufijos societarios comunes que generan falsos positivos
    (S.A.C. vs SAC vs Sociedad Anonima Cerrada)."""
    texto_sin_tildes = "".join(
        c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)
    )
    texto_normalizado = texto_sin_tildes.upper()
    for sufijo in (
        "SOCIEDAD ANONIMA CERRADA", "SOCIEDAD ANONIMA", "SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA",
        "S.A.C.", "S.A.C", "SAC", "S.A.", "S.A", "SA", "S.R.L.", "S.R.L", "SRL", "E.I.R.L.", "EIRL",
        "LTDA", "LLC", "INC.", "INC", "CORP.", "CORP", "CO.", "LTD.", "LTD",
    ):
        texto_normalizado = texto_normalizado.replace(sufijo, "")
    return " ".join(texto_normalizado.split())


def _diferencia_relativa(a: float, b: float) -> float:
    """Diferencia relativa entre dos numeros, tomando como base el mayor
    de los dos para que la tolerancia sea simetrica."""
    base = max(abs(a), abs(b))
    if base == 0:
        return 0.0
    return abs(a - b) / base


# ---------------------------------------------------------------------
# Reglas individuales
# ---------------------------------------------------------------------

def validar_peso_bultos_factura_vs_bl(factura: FacturaSchema, bl: BLSchema) -> list[ResultadoValidacion]:
    """Compara peso bruto (tolerancia 1%) y cantidad de bultos (exacta)
    entre la Factura Comercial y el BL."""
    resultados: list[ResultadoValidacion] = []

    if factura.peso_bruto_kg is None or bl.peso_bruto_kg is None:
        resultados.append(ResultadoValidacion(
            regla="PESO_FACTURA_VS_BL",
            severidad="MEDIA",
            detalle="No se pudo validar el peso bruto: falta el dato en la Factura y/o en el BL.",
            valor_a={"peso_bruto_kg_factura": factura.peso_bruto_kg},
            valor_b={"peso_bruto_kg_bl": bl.peso_bruto_kg},
        ))
    else:
        diferencia = _diferencia_relativa(factura.peso_bruto_kg, bl.peso_bruto_kg)
        if diferencia <= TOLERANCIA_PESO:
            resultados.append(ResultadoValidacion(
                regla="PESO_FACTURA_VS_BL",
                severidad="NINGUNA",
                detalle=f"Peso bruto coherente entre Factura ({factura.peso_bruto_kg} kg) y BL ({bl.peso_bruto_kg} kg).",
                valor_a={"peso_bruto_kg_factura": factura.peso_bruto_kg},
                valor_b={"peso_bruto_kg_bl": bl.peso_bruto_kg},
            ))
        else:
            resultados.append(ResultadoValidacion(
                regla="PESO_FACTURA_VS_BL",
                severidad="ALTA",
                detalle=(
                    f"El peso bruto declarado difiere en {diferencia:.1%} entre la Factura "
                    f"({factura.peso_bruto_kg} kg) y el BL ({bl.peso_bruto_kg} kg); tolerancia permitida: {TOLERANCIA_PESO:.0%}."
                ),
                valor_a={"peso_bruto_kg_factura": factura.peso_bruto_kg},
                valor_b={"peso_bruto_kg_bl": bl.peso_bruto_kg},
            ))

    if factura.cantidad_bultos is None or bl.cantidad_bultos is None:
        resultados.append(ResultadoValidacion(
            regla="BULTOS_FACTURA_VS_BL",
            severidad="MEDIA",
            detalle="No se pudo validar la cantidad de bultos: falta el dato en la Factura y/o en el BL.",
            valor_a={"cantidad_bultos_factura": factura.cantidad_bultos},
            valor_b={"cantidad_bultos_bl": bl.cantidad_bultos},
        ))
    elif factura.cantidad_bultos == bl.cantidad_bultos:
        resultados.append(ResultadoValidacion(
            regla="BULTOS_FACTURA_VS_BL",
            severidad="NINGUNA",
            detalle=f"Cantidad de bultos coincide: {factura.cantidad_bultos}.",
            valor_a={"cantidad_bultos_factura": factura.cantidad_bultos},
            valor_b={"cantidad_bultos_bl": bl.cantidad_bultos},
        ))
    else:
        resultados.append(ResultadoValidacion(
            regla="BULTOS_FACTURA_VS_BL",
            severidad="ALTA",
            detalle=(
                f"La cantidad de bultos difiere entre la Factura ({factura.cantidad_bultos}) "
                f"y el BL ({bl.cantidad_bultos})."
            ),
            valor_a={"cantidad_bultos_factura": factura.cantidad_bultos},
            valor_b={"cantidad_bultos_bl": bl.cantidad_bultos},
        ))

    return resultados


def validar_monto_factura_vs_swift(factura: FacturaSchema, swift: SwiftSchema) -> ResultadoValidacion:
    """Verifica coherencia entre el monto facturado y el monto transferido.
    Un pago menor al total (anticipo) es MEDIA; un pago mayor al total
    (sobrepago o error de digitacion) es ALTA."""
    regla = "MONTO_FACTURA_VS_SWIFT"

    if factura.moneda.upper() != swift.moneda.upper():
        return ResultadoValidacion(
            regla=regla,
            severidad="MEDIA",
            detalle=(
                f"La moneda de la Factura ({factura.moneda}) difiere de la del SWIFT ({swift.moneda}); "
                f"no se puede comparar el monto directamente sin una tasa de cambio."
            ),
            valor_a={"monto_total_factura": factura.monto_total, "moneda_factura": factura.moneda},
            valor_b={"monto_swift": swift.monto, "moneda_swift": swift.moneda},
        )

    if swift.monto > factura.monto_total:
        severidad: Severidad = "ALTA"
        detalle = (
            f"El monto transferido por SWIFT ({swift.monto} {swift.moneda}) es mayor al monto "
            f"facturado ({factura.monto_total} {factura.moneda}); podria tratarse de un error o de un "
            f"pago que incluye otros conceptos no facturados."
        )
    elif swift.monto < factura.monto_total:
        severidad = "MEDIA"
        detalle = (
            f"El monto transferido por SWIFT ({swift.monto} {swift.moneda}) es menor al monto "
            f"facturado ({factura.monto_total} {factura.moneda}); podria tratarse de un pago parcial/anticipo "
            f"pendiente de completar."
        )
    else:
        severidad = "NINGUNA"
        detalle = f"El monto transferido por SWIFT coincide con el monto facturado ({factura.monto_total} {factura.moneda})."

    return ResultadoValidacion(
        regla=regla,
        severidad=severidad,
        detalle=detalle,
        valor_a={"monto_total_factura": factura.monto_total, "moneda_factura": factura.moneda},
        valor_b={"monto_swift": swift.monto, "moneda_swift": swift.moneda},
    )


def validar_valor_asegurado_vs_factura(seguro: SeguroSchema, factura: FacturaSchema) -> ResultadoValidacion:
    """El valor asegurado tipicamente debe ser igual o mayor al monto
    facturado (una poliza CIF suele cubrir mercancia + flete + seguro).
    Un valor asegurado menor al de la factura es una senal de
    subaseguramiento (severidad ALTA)."""
    regla = "VALOR_ASEGURADO_VS_FACTURA"

    if seguro.moneda.upper() != factura.moneda.upper():
        return ResultadoValidacion(
            regla=regla,
            severidad="MEDIA",
            detalle=(
                f"La moneda de la Poliza ({seguro.moneda}) difiere de la de la Factura ({factura.moneda}); "
                f"no se puede comparar el valor asegurado directamente sin una tasa de cambio."
            ),
            valor_a={"valor_asegurado": seguro.valor_asegurado, "moneda_seguro": seguro.moneda},
            valor_b={"monto_total_factura": factura.monto_total, "moneda_factura": factura.moneda},
        )

    if seguro.valor_asegurado < factura.monto_total:
        severidad: Severidad = "ALTA"
        detalle = (
            f"El valor asegurado ({seguro.valor_asegurado} {seguro.moneda}) es menor al monto facturado "
            f"({factura.monto_total} {factura.moneda}); la carga podria estar subasegurada."
        )
    elif _diferencia_relativa(seguro.valor_asegurado, factura.monto_total) > UMBRAL_DIFERENCIA_SEGURO:
        severidad = "MEDIA"
        detalle = (
            f"El valor asegurado ({seguro.valor_asegurado} {seguro.moneda}) supera en mas de "
            f"{UMBRAL_DIFERENCIA_SEGURO:.0%} al monto facturado ({factura.monto_total} {factura.moneda}); "
            f"conviene revisar que la diferencia corresponda a flete y prima de seguro."
        )
    else:
        severidad = "NINGUNA"
        detalle = (
            f"El valor asegurado ({seguro.valor_asegurado} {seguro.moneda}) es coherente con el monto "
            f"facturado ({factura.monto_total} {factura.moneda})."
        )

    return ResultadoValidacion(
        regla=regla,
        severidad=severidad,
        detalle=detalle,
        valor_a={"valor_asegurado": seguro.valor_asegurado, "moneda_seguro": seguro.moneda},
        valor_b={"monto_total_factura": factura.monto_total, "moneda_factura": factura.moneda},
    )


def validar_consignatario_factura_vs_bl(factura: FacturaSchema, bl: BLSchema) -> ResultadoValidacion:
    """Chequeo estricto (antifraude): el comprador/consignatario de la
    Factura debe corresponder al consignatario del BL. Se normalizan
    sufijos societarios y se usa similitud difusa para tolerar pequenas
    variaciones de formato sin dejar pasar razones sociales distintas."""
    regla = "CONSIGNATARIO_FACTURA_VS_BL"

    normalizado_factura = _normalizar_razon_social(factura.comprador_consignatario)
    normalizado_bl = _normalizar_razon_social(bl.consignatario)
    similitud = fuzz.ratio(normalizado_factura, normalizado_bl) / 100

    if similitud >= UMBRAL_SIMILITUD_CONSIGNATARIO:
        severidad: Severidad = "NINGUNA"
        detalle = (
            f"El consignatario de la Factura ('{factura.comprador_consignatario}') coincide con el del BL "
            f"('{bl.consignatario}')."
        )
    else:
        severidad = "ALTA"
        detalle = (
            f"El consignatario de la Factura ('{factura.comprador_consignatario}') no coincide con el del BL "
            f"('{bl.consignatario}'); similitud {similitud:.0%}, por debajo del umbral requerido "
            f"({UMBRAL_SIMILITUD_CONSIGNATARIO:.0%}). Este es un chequeo antifraude critico."
        )

    return ResultadoValidacion(
        regla=regla,
        severidad=severidad,
        detalle=detalle,
        valor_a={"consignatario_factura": factura.comprador_consignatario},
        valor_b={"consignatario_bl": bl.consignatario},
    )


def validar_incoterm(factura: FacturaSchema, bl: BLSchema) -> ResultadoValidacion:
    """Compara el Incoterm declarado en Factura y BL. El BL no siempre lo
    trae explicito, en cuyo caso el chequeo queda como no verificable."""
    regla = "INCOTERM"

    if not factura.incoterm or not bl.incoterm:
        return ResultadoValidacion(
            regla=regla,
            severidad="MEDIA",
            detalle="No se pudo verificar el Incoterm: no figura explicitamente en la Factura y/o en el BL.",
            valor_a={"incoterm_factura": factura.incoterm},
            valor_b={"incoterm_bl": bl.incoterm},
        )

    if factura.incoterm.strip().upper() == bl.incoterm.strip().upper():
        severidad: Severidad = "NINGUNA"
        detalle = f"El Incoterm coincide entre la Factura y el BL ({factura.incoterm.upper()})."
    else:
        severidad = "ALTA"
        detalle = (
            f"El Incoterm declarado en la Factura ({factura.incoterm}) difiere del declarado en el BL "
            f"({bl.incoterm})."
        )

    return ResultadoValidacion(
        regla=regla,
        severidad=severidad,
        detalle=detalle,
        valor_a={"incoterm_factura": factura.incoterm},
        valor_b={"incoterm_bl": bl.incoterm},
    )


# ---------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------

def ejecutar_validaciones(documentos: dict[TipoDocumento, BaseModel]) -> list[ResultadoValidacion]:
    """Ejecuta todas las reglas cruzadas posibles con los documentos
    disponibles. Si falta un documento requerido para una regla, se
    reporta esa regla como no verificable (severidad MEDIA) en vez de
    lanzar un error, para que el resto de validaciones se sigan
    ejecutando con lo que si esta disponible."""
    resultados: list[ResultadoValidacion] = []

    factura = documentos.get("FACTURA")
    seguro = documentos.get("SEGURO")
    swift = documentos.get("SWIFT_BANCARIO")
    bl = documentos.get("BL")

    if factura and bl:
        resultados.extend(validar_peso_bultos_factura_vs_bl(factura, bl))
        resultados.append(validar_consignatario_factura_vs_bl(factura, bl))
        resultados.append(validar_incoterm(factura, bl))
    else:
        faltantes = [n for n, d in (("FACTURA", factura), ("BL", bl)) if d is None]
        resultados.append(ResultadoValidacion(
            regla="PESO_BULTOS_CONSIGNATARIO_INCOTERM",
            severidad="MEDIA",
            detalle=f"No se pudo comparar Factura vs BL: falta(n) {', '.join(faltantes)}.",
        ))

    if factura and swift:
        resultados.append(validar_monto_factura_vs_swift(factura, swift))
    else:
        faltantes = [n for n, d in (("FACTURA", factura), ("SWIFT_BANCARIO", swift)) if d is None]
        resultados.append(ResultadoValidacion(
            regla="MONTO_FACTURA_VS_SWIFT",
            severidad="MEDIA",
            detalle=f"No se pudo comparar Factura vs SWIFT: falta(n) {', '.join(faltantes)}.",
        ))

    if seguro and factura:
        resultados.append(validar_valor_asegurado_vs_factura(seguro, factura))
    else:
        faltantes = [n for n, d in (("SEGURO", seguro), ("FACTURA", factura)) if d is None]
        resultados.append(ResultadoValidacion(
            regla="VALOR_ASEGURADO_VS_FACTURA",
            severidad="MEDIA",
            detalle=f"No se pudo comparar Seguro vs Factura: falta(n) {', '.join(faltantes)}.",
        ))

    return resultados


def hay_informacion_suficiente_para_clasificar(factura: FacturaSchema) -> bool:
    """Regla minima para decidir si hay datos tecnicos suficientes para
    intentar una clasificacion arancelaria: la descripcion general de la
    mercancia no debe estar vacia, y al menos un item debe traer material
    declarado o una descripcion lo bastante detallada (mas de 15
    caracteres, umbral simple para descartar descripciones genericas
    como 'mercaderia varia')."""
    if not factura.descripcion_mercancia or not factura.descripcion_mercancia.strip():
        return False

    if not factura.items:
        return len(factura.descripcion_mercancia.strip()) > 15

    return any(
        (item.material_declarado and item.material_declarado.strip())
        or len(item.descripcion.strip()) > 15
        for item in factura.items
    )
