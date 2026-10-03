"""Consulta en vivo de los gravamenes vigentes de una subpartida en el
portal de SUNAT (aduanet.gob.pe/itarancel).

El portal no tiene API ni HTTPS, y la consulta no se puede abrir con un
link: es un POST cuyo resultado queda en la sesion del servidor y se lee
despues desde un iframe. Se replica esa secuencia con httpx:

1. GET a la pagina de consulta -- inicia la sesion (sin esto el detalle
   responde 500).
2. POST `accion=buscarPartida` con el codigo de 10 digitos sin puntos.
3. GET al JSP del detalle ("Medidas Impositivas"), que lee la sesion.

El parseo es por etiquetas de texto, no por posicion de celdas: el HTML es
de tablas anidadas de los 2000 y cualquier ajuste menor de maquetacion
romperia un parseo posicional.
"""

import html
import re

import httpx
from pydantic import BaseModel

URL_BASE = "http://www.aduanet.gob.pe/itarancel"
URL_CONSULTA = f"{URL_BASE}/arancelS01Alias"
TIMEOUT_SEGUNDOS = 20

# Etiqueta tal como la imprime SUNAT -> nombre que mostramos. El orden es
# el de la pagina de SUNAT.
_CONCEPTOS: list[tuple[str, str]] = [
    ("Ad / Valorem", "Ad Valorem"),
    ("Impuesto Selectivo al Consumo", "Impuesto Selectivo al Consumo"),
    ("Impuesto General a las Ventas", "Impuesto General a las Ventas"),
    ("Impuesto de Promoción Municipal", "Impuesto de Promoción Municipal"),
    ("Impuesto al Rodaje", "Impuesto al Rodaje"),
    ("Derecho Específicos", "Derechos específicos"),
    ("Derecho Antidumping", "Derecho antidumping"),
    ("Seguro", "Seguro"),
    ("Sobretasa Tributo", "Sobretasa tributo"),
    ("Sobretasa Sanción", "Sobretasa sanción"),
]

# SUNAT marca con "S" los derechos que aplican pero dependen de otra
# consulta (ej. antidumping por pais de origen) y con "N.A." los que no.
_VALORES_LEGIBLES = {"S": "Aplica", "N.A.": "No aplica"}


class GravamenSunat(BaseModel):
    concepto: str
    valor: str


class MedidasSunat(BaseModel):
    subpartida: str
    tipo_producto: str | None
    gravamenes: list[GravamenSunat]
    url_consulta: str


class SunatNoDisponibleError(Exception):
    """El portal de SUNAT no respondio o devolvio algo que no se pudo leer."""


def _lineas_de_texto(contenido: str) -> list[str]:
    texto = re.sub(r"(?is)<script.*?</script>|<style.*?</style>|<!--.*?-->", "", contenido)
    texto = re.sub(r"(?i)</tr>|</td>|<br\s*/?>|</p>|</center>|</table>", "\n", texto)
    texto = html.unescape(re.sub(r"<[^>]+>", " ", texto))
    return [linea for linea in (" ".join(l.split()) for l in texto.split("\n")) if linea]


def consultar_medidas_sunat(codigo: str) -> MedidasSunat | None:
    """`codigo`: subpartida de 10 digitos, con o sin puntos. Devuelve None
    si SUNAT dice que la partida no existe."""
    digitos = codigo.replace(".", "")
    try:
        with httpx.Client(
            timeout=TIMEOUT_SEGUNDOS,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Aduafy)"},
        ) as cliente:
            cliente.get(URL_CONSULTA).raise_for_status()
            busqueda = cliente.post(
                URL_CONSULTA,
                params={"accion": "buscarPartida", "esframe": "1"},
                data={"cod_partida": digitos, "desc_partida": ""},
            )
            busqueda.raise_for_status()
            if "No se encuentra partida" in busqueda.content.decode("latin-1"):
                return None
            detalle = cliente.get(f"{URL_BASE}/JSPDetallePartidaArancel.jsp")
            detalle.raise_for_status()
    except httpx.HTTPError as error:
        raise SunatNoDisponibleError(f"No se pudo consultar el portal de SUNAT: {error}") from error

    lineas = _lineas_de_texto(detalle.content.decode("latin-1"))

    gravamenes: list[GravamenSunat] = []
    for etiqueta_sunat, concepto in _CONCEPTOS:
        try:
            indice = lineas.index(etiqueta_sunat)
        except ValueError:
            continue
        if indice + 1 < len(lineas):
            valor = lineas[indice + 1]
            gravamenes.append(GravamenSunat(concepto=concepto, valor=_VALORES_LEGIBLES.get(valor, valor)))

    if not gravamenes:
        raise SunatNoDisponibleError("SUNAT respondió, pero la página no tiene el formato esperado.")

    subpartida = next(
        (m.group(1) for l in lineas if (m := re.search(r"SUBPARTIDA NACIONAL ([\d.]+)", l))), codigo
    )
    tipo_producto = None
    if "TIPO DE PRODUCTO:" in lineas:
        siguiente = lineas.index("TIPO DE PRODUCTO:") + 1
        if siguiente < len(lineas) and lineas[siguiente] != "Gravámenes Vigentes":
            tipo_producto = lineas[siguiente]

    return MedidasSunat(
        subpartida=subpartida,
        tipo_producto=tipo_producto,
        gravamenes=gravamenes,
        url_consulta=URL_CONSULTA,
    )
