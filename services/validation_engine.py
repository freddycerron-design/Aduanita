"""
Motor de validaciones cruzadas entre los documentos de un despacho.

Antes (hasta antes de la migracion `reglas_validacion`) esto era 5
funciones Python hardcodeadas, una por regla, cada una con su propia
logica de comparacion y sus umbrales como constantes de modulo. Ahora es
un motor generico: cada regla es una fila de la tabla `reglas_validacion`
(administrable por un ADMIN via `app/main.py`, sin tocar codigo), y este
archivo solo sabe interpretar 3 "tipos de comparacion" genericos contra
los campos de 2 documentos cualesquiera.

Los 3 tipos cubren, con distintos parametros, las 5 reglas originales:
- RANGO_ASIMETRICO: numerico, compara una diferencia relativa SIGNADA
  contra dos umbrales independientes (uno por direccion). Cubre peso
  (tolerancia simetrica), monto-vs-SWIFT y valor-asegurado-vs-Factura
  (ambas asimetricas, con severidades distintas segun el signo).
- IGUALDAD_EXACTA: compara 2 valores (numericos o texto, con
  normalizacion opcional). Cubre bultos e Incoterm.
- TEXTO_FUZZY: normaliza razones sociales (sufijos societarios, tildes)
  y compara similitud con rapidfuzz. Cubre consignatario.
"""
from __future__ import annotations

import unicodedata
from typing import Literal

from pydantic import BaseModel
from rapidfuzz import fuzz

from services.pdf_processor import FacturaSchema, TipoDocumento, _NOMBRE_DOCUMENTO_LEGIBLE

Severidad = Literal["ALTA", "MEDIA", "NINGUNA"]
TipoComparacion = Literal["RANGO_ASIMETRICO", "IGUALDAD_EXACTA", "TEXTO_FUZZY"]


class ResultadoValidacion(BaseModel):
    regla: str
    severidad: Severidad
    detalle: str
    valor_a: dict | None = None
    valor_b: dict | None = None


class ReglaValidacion(BaseModel):
    """Espejo de una fila de `reglas_validacion`. `documento_a`/`documento_b`
    y `campo_a`/`campo_b` ya se validaron en la API (contra
    `TIPO_A_SCHEMA[...].model_fields`) al crear/editar la regla -- este
    motor confia en que son validos y solo puede fallar en tiempo de
    ejecucion si el dato del documento concreto no tiene ese atributo
    (lo cual no deberia pasar si la validacion de escritura funciono)."""

    id: str
    codigo: str
    nombre: str
    descripcion: str | None = None
    activo: bool
    documento_a: TipoDocumento
    campo_a: str
    documento_b: TipoDocumento
    campo_b: str
    campo_moneda_a: str | None = None
    campo_moneda_b: str | None = None
    severidad_moneda_distinta: Severidad | None = None
    severidad_dato_faltante: Severidad
    tipo_comparacion: TipoComparacion
    parametros: dict


class ParametrosRangoAsimetrico(BaseModel):
    umbral_inferior: float
    severidad_inferior: Severidad
    umbral_superior: float
    severidad_superior: Severidad


class ParametrosIgualdadExacta(BaseModel):
    severidad_si_distinto: Severidad
    normalizar_texto: bool = False


class ParametrosTextoFuzzy(BaseModel):
    umbral_similitud: float
    severidad_si_distinto: Severidad


def _normalizar_razon_social(texto: str) -> str:
    """Normaliza una razon social para comparacion difusa: mayusculas, sin
    tildes y sin sufijos societarios comunes que generan falsos positivos
    (S.A.C. vs SAC vs Sociedad Anonima Cerrada). Logica de dominio fija
    (Peru), no configurable por el admin."""
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


def _diferencia_relativa_signada(a: float, b: float) -> float:
    """Diferencia relativa SIGNADA de b respecto de a, tomando como base el
    mayor de los dos en valor absoluto (para que un umbral simetrico de
    tolerancia sea comparable en ambas direcciones). Positiva si b > a."""
    base = max(abs(a), abs(b))
    if base == 0:
        return 0.0
    return (b - a) / base


def _es_dato_faltante(valor: object) -> bool:
    if valor is None:
        return True
    if isinstance(valor, str) and not valor.strip():
        return True
    return False


# ---------------------------------------------------------------------
# Aplicacion generica de una regla
# ---------------------------------------------------------------------

def _aplicar_rango_asimetrico(
    regla: ReglaValidacion, valor_a: float, valor_b: float, etiqueta_a: str, etiqueta_b: str
) -> ResultadoValidacion:
    p = ParametrosRangoAsimetrico.model_validate(regla.parametros)
    diferencia = _diferencia_relativa_signada(valor_a, valor_b)

    if diferencia < p.umbral_inferior:
        severidad = p.severidad_inferior
        detalle = (
            f"{regla.nombre}: el valor de {_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_b]} ({valor_b}) es "
            f"menor al de {_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_a]} ({valor_a}) en {abs(diferencia):.1%}."
        )
    elif diferencia > p.umbral_superior:
        severidad = p.severidad_superior
        detalle = (
            f"{regla.nombre}: el valor de {_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_b]} ({valor_b}) es "
            f"mayor al de {_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_a]} ({valor_a}) en {diferencia:.1%}."
        )
    else:
        severidad = "NINGUNA"
        detalle = (
            f"{regla.nombre}: valores coherentes ({_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_a]}={valor_a}, "
            f"{_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_b]}={valor_b})."
        )

    return ResultadoValidacion(
        regla=regla.codigo, severidad=severidad, detalle=detalle,
        valor_a={etiqueta_a: valor_a}, valor_b={etiqueta_b: valor_b},
    )


def _aplicar_igualdad_exacta(
    regla: ReglaValidacion, valor_a: object, valor_b: object, etiqueta_a: str, etiqueta_b: str
) -> ResultadoValidacion:
    p = ParametrosIgualdadExacta.model_validate(regla.parametros)
    if p.normalizar_texto:
        iguales = str(valor_a).strip().upper() == str(valor_b).strip().upper()
    else:
        iguales = valor_a == valor_b

    severidad: Severidad = "NINGUNA" if iguales else p.severidad_si_distinto
    detalle = (
        f"{regla.nombre}: coincide ({valor_a})."
        if iguales else
        f"{regla.nombre}: difiere entre {_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_a]} ({valor_a}) y "
        f"{_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_b]} ({valor_b})."
    )
    return ResultadoValidacion(
        regla=regla.codigo, severidad=severidad, detalle=detalle,
        valor_a={etiqueta_a: valor_a}, valor_b={etiqueta_b: valor_b},
    )


def _aplicar_texto_fuzzy(
    regla: ReglaValidacion, valor_a: object, valor_b: object, etiqueta_a: str, etiqueta_b: str
) -> ResultadoValidacion:
    p = ParametrosTextoFuzzy.model_validate(regla.parametros)
    normalizado_a = _normalizar_razon_social(str(valor_a))
    normalizado_b = _normalizar_razon_social(str(valor_b))
    similitud = fuzz.ratio(normalizado_a, normalizado_b) / 100

    if similitud >= p.umbral_similitud:
        severidad: Severidad = "NINGUNA"
        detalle = f"{regla.nombre}: coincide ('{valor_a}' ~ '{valor_b}')."
    else:
        severidad = p.severidad_si_distinto
        detalle = (
            f"{regla.nombre}: '{valor_a}' no coincide con '{valor_b}' (similitud {similitud:.0%}, "
            f"umbral {p.umbral_similitud:.0%})."
        )
    return ResultadoValidacion(
        regla=regla.codigo, severidad=severidad, detalle=detalle,
        valor_a={etiqueta_a: valor_a}, valor_b={etiqueta_b: valor_b},
    )


def _aplicar_regla(regla: ReglaValidacion, documentos: dict[TipoDocumento, BaseModel]) -> ResultadoValidacion:
    doc_a = documentos.get(regla.documento_a)
    doc_b = documentos.get(regla.documento_b)

    if doc_a is None or doc_b is None:
        faltantes = [
            _NOMBRE_DOCUMENTO_LEGIBLE[n] for n, d in ((regla.documento_a, doc_a), (regla.documento_b, doc_b))
            if d is None
        ]
        return ResultadoValidacion(
            regla=regla.codigo,
            severidad=regla.severidad_dato_faltante,
            detalle=f"No se pudo aplicar '{regla.nombre}': falta {' y '.join(faltantes)}.",
        )

    valor_a = getattr(doc_a, regla.campo_a)
    valor_b = getattr(doc_b, regla.campo_b)
    etiqueta_a = f"{regla.campo_a}_{regla.documento_a.lower()}"
    etiqueta_b = f"{regla.campo_b}_{regla.documento_b.lower()}"

    if _es_dato_faltante(valor_a) or _es_dato_faltante(valor_b):
        return ResultadoValidacion(
            regla=regla.codigo,
            severidad=regla.severidad_dato_faltante,
            detalle=f"No se pudo aplicar '{regla.nombre}': falta el dato en uno de los dos documentos.",
            valor_a={etiqueta_a: valor_a}, valor_b={etiqueta_b: valor_b},
        )

    if regla.campo_moneda_a and regla.campo_moneda_b:
        moneda_a = str(getattr(doc_a, regla.campo_moneda_a) or "").upper()
        moneda_b = str(getattr(doc_b, regla.campo_moneda_b) or "").upper()
        if moneda_a and moneda_b and moneda_a != moneda_b:
            return ResultadoValidacion(
                regla=regla.codigo,
                severidad=regla.severidad_moneda_distinta or "MEDIA",
                detalle=(
                    f"{regla.nombre}: la moneda de {_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_a]} ({moneda_a}) "
                    f"difiere de la de {_NOMBRE_DOCUMENTO_LEGIBLE[regla.documento_b]} ({moneda_b}); no se puede "
                    f"comparar directamente sin una tasa de cambio."
                ),
                valor_a={etiqueta_a: valor_a}, valor_b={etiqueta_b: valor_b},
            )

    if regla.tipo_comparacion == "RANGO_ASIMETRICO":
        return _aplicar_rango_asimetrico(regla, valor_a, valor_b, etiqueta_a, etiqueta_b)
    if regla.tipo_comparacion == "IGUALDAD_EXACTA":
        return _aplicar_igualdad_exacta(regla, valor_a, valor_b, etiqueta_a, etiqueta_b)
    return _aplicar_texto_fuzzy(regla, valor_a, valor_b, etiqueta_a, etiqueta_b)


def ejecutar_validaciones(
    documentos: dict[TipoDocumento, BaseModel], reglas: list[ReglaValidacion]
) -> list[ResultadoValidacion]:
    """Ejecuta todas las reglas ACTIVAS contra los documentos disponibles.
    Si a una regla le falta un documento entero o un campo especifico, se
    reporta esa regla puntual como no verificable (severidad configurable
    por regla, `severidad_dato_faltante`) en vez de lanzar un error, para
    que el resto de reglas se sigan evaluando con lo que si esta
    disponible -- mismo espiritu que el motor anterior, pero ahora un
    resultado por regla individual en vez de un resultado "paraguas" que
    agrupaba varias reglas por par de documentos (esa agrupacion fija ya
    no tiene sentido una vez que las reglas son dinamicas: dos reglas
    activas pueden compartir par de documentos o no, es un hecho que solo
    se sabe en tiempo de ejecucion)."""
    return [_aplicar_regla(regla, documentos) for regla in reglas if regla.activo]


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
