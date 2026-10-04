"""Consulta en vivo de los gravamenes vigentes de una subpartida en el
portal de SUNAT (aduanet.gob.pe/itarancel).

El portal no tiene API ni HTTPS, y la consulta no se puede abrir con un
link: es un POST cuyo resultado queda en la sesion del servidor y se lee
despues desde un iframe. Se replica esa secuencia con httpx:

1. GET a la pagina de consulta -- inicia la sesion (sin esto el detalle
   responde 500).
2. POST `accion=buscarPartida` con el codigo de 10 digitos sin puntos.
3. GET al JSP del detalle ("Medidas Impositivas"), que lee la sesion.
4. GET al JSP del listado: la ubicacion de la subpartida en la
   nomenclatura (seccion, capitulo y las partidas vecinas con todos sus
   niveles), el mismo marco que SUNAT muestra a la izquierda.

El parseo es por etiquetas de texto, no por posicion de celdas: el HTML es
de tablas anidadas de los 2000 y cualquier ajuste menor de maquetacion
romperia un parseo posicional.
"""

import html
from html.parser import HTMLParser
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


class EncabezadoNomenclatura(BaseModel):
    """Seccion o capitulo: numero (romano / 2 digitos) y titulo."""

    numero: str
    titulo: str


class LineaNomenclatura(BaseModel):
    """Una fila del listado de SUNAT.

    `codigo` es None en los textos intermedios sin codigo propio (ej.
    "- - - Electricos o electronicos:"). `nivel` es la cantidad de guiones
    con que SUNAT indenta la descripcion (0 para la partida de 4 digitos);
    la descripcion se devuelve sin esos guiones. Solo las subpartidas
    nacionales (10 digitos) se pueden consultar.
    """

    codigo: str | None
    descripcion: str
    nivel: int
    es_subpartida_nacional: bool
    es_actual: bool


class UbicacionNomenclatura(BaseModel):
    seccion: EncabezadoNomenclatura | None
    capitulo: EncabezadoNomenclatura | None
    lineas: list[LineaNomenclatura]


class MedidasSunat(BaseModel):
    subpartida: str
    tipo_producto: str | None
    gravamenes: list[GravamenSunat]
    # None si el listado no se pudo leer: los gravamenes siguen siendo
    # utiles solos, no vale la pena fallar toda la consulta por esto.
    ubicacion: UbicacionNomenclatura | None = None
    url_consulta: str


class SunatNoDisponibleError(Exception):
    """El portal de SUNAT no respondio o devolvio algo que no se pudo leer."""


def _lineas_de_texto(contenido: str) -> list[str]:
    texto = re.sub(r"(?is)<script.*?</script>|<style.*?</style>|<!--.*?-->", "", contenido)
    texto = re.sub(r"(?i)</tr>|</td>|<br\s*/?>|</p>|</center>|</table>", "\n", texto)
    texto = html.unescape(re.sub(r"<[^>]+>", " ", texto))
    return [linea for linea in (" ".join(l.split()) for l in texto.split("\n")) if linea]


_RE_FILA = re.compile(r"<tr\b([^>]*)>(.*?)</tr>", re.S | re.I)
_RE_CELDA = re.compile(r"<td\b[^>]*>(.*?)</td>", re.S | re.I)
_RE_CODIGO = re.compile(r"^\d{2}\.\d{2}$|^\d{4}\.\d{2}(\.\d{2}){0,2}$")
_RE_GUIONES = re.compile(r"^((?:-\s*)+)")
# SUNAT resalta la fila consultada con este fondo (y letra roja).
_FONDO_FILA_ACTUAL = "#def3fa"


def _texto(fragmento: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragmento)).split())


def _parsear_listado(contenido: str) -> UbicacionNomenclatura | None:
    """Filas de 2 celdas (codigo | descripcion). Las dos primeras son
    "SECCIÓN:XVIII" y "CAPITULO:90" con su titulo."""
    seccion = capitulo = None
    lineas: list[LineaNomenclatura] = []
    for atributos, cuerpo in _RE_FILA.findall(contenido):
        celdas = _RE_CELDA.findall(cuerpo)
        if len(celdas) != 2:
            continue
        codigo, descripcion = _texto(celdas[0]), _texto(celdas[1])
        rotulo = codigo.upper()
        if rotulo.startswith("SECCI"):
            seccion = EncabezadoNomenclatura(numero=codigo.split(":", 1)[-1].strip(), titulo=descripcion)
            continue
        if rotulo.startswith("CAPITULO") or rotulo.startswith("CAPÍTULO"):
            capitulo = EncabezadoNomenclatura(numero=codigo.split(":", 1)[-1].strip(), titulo=descripcion)
            continue
        if not descripcion or (codigo and not _RE_CODIGO.match(codigo)):
            continue
        guiones = _RE_GUIONES.match(descripcion)
        nivel = guiones.group(1).count("-") if guiones else 0
        lineas.append(
            LineaNomenclatura(
                codigo=codigo or None,
                descripcion=descripcion[guiones.end():].strip() if guiones else descripcion,
                nivel=nivel,
                es_subpartida_nacional=len(codigo.replace(".", "")) == 10,
                es_actual=_FONDO_FILA_ACTUAL in atributos.lower(),
            )
        )
    if not lineas:
        return None
    return UbicacionNomenclatura(seccion=seccion, capitulo=capitulo, lineas=lineas)


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
            try:
                listado = cliente.get(f"{URL_BASE}/JSPListadoPartidaArancel.jsp")
                listado.raise_for_status()
                ubicacion = _parsear_listado(listado.content.decode("latin-1"))
            except httpx.HTTPError:
                ubicacion = None
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
        ubicacion=ubicacion,
        url_consulta=URL_CONSULTA,
    )


# ---------------------------------------------------------------------------
# Anexos de la subpartida ("Otros requisitos para la comercializacion con
# otros paises" al pie del detalle de SUNAT)
# ---------------------------------------------------------------------------

# tipo -> (accion del portal, titulo). Todas leen la subpartida de la
# sesion abierta por la busqueda: abiertas como link suelto (sin el POST
# previo) SUNAT responde su "Pagina de Errores", por eso se consultan desde
# el backend y no se enlazan directo.
ANEXOS_SUNAT: dict[str, tuple[str, str]] = {
    "correlaciones": ("consultarPartidaCorrelacion", "Correlaciones"),
    "convenios": ("consultarConvenio", "Convenio internacional"),
    "restricciones": ("consultarPartidaRestriccion", "Restricciones"),
    "descripciones": ("consultarPartidaDescripciones", "Descripciones mínimas"),
}


class AnexoSunat(BaseModel):
    tipo: str
    titulo: str
    # HTML ya saneado (ver _HtmlSaneado): solo estructura de tabla y texto,
    # sin atributos, scripts, links ni imagenes.
    html: str


class _HtmlSaneado(HTMLParser):
    """Reescribe el HTML de SUNAT dejando solo etiquetas de estructura
    (tablas, parrafos, negritas) SIN atributos, y todo el texto escapado.
    El frontend lo inserta como HTML, asi que esta lista blanca es la
    barrera contra cualquier cosa que el portal (o alguien en el medio,
    es HTTP plano) pueda inyectar."""

    _PERMITIDAS = {"table", "thead", "tbody", "tr", "td", "th", "p", "br", "b", "strong", "ul", "ol", "li"}
    _DESCARTAR_CONTENIDO = {"script", "style", "head", "title", "select", "option", "button"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.partes: list[str] = []
        self._descartando = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._DESCARTAR_CONTENIDO:
            self._descartando += 1
        elif not self._descartando and tag in self._PERMITIDAS:
            extra = ""
            # colspan/rowspan sostienen la forma de las tablas; solo numeros.
            for nombre, valor in attrs:
                if nombre in ("colspan", "rowspan") and valor and valor.isdigit():
                    extra += f' {nombre}="{valor}"'
            self.partes.append(f"<{tag}{extra}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._DESCARTAR_CONTENIDO:
            self._descartando = max(0, self._descartando - 1)
        elif not self._descartando and tag in self._PERMITIDAS and tag != "br":
            self.partes.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self._descartando:
            return
        texto = " ".join(data.split())
        # "Retornar" es el boton de volver del portal, sin sentido aca.
        if texto and texto.lower() != "retornar":
            self.partes.append(html.escape(texto))


def _sanear(contenido: str) -> str:
    saneador = _HtmlSaneado()
    saneador.feed(contenido)
    saneador.close()
    resultado = " ".join(saneador.partes)
    # Filas y celdas que quedaron vacias al sacar imagenes/links.
    resultado = re.sub(r"<td>\s*</td>", "<td></td>", resultado)
    resultado = re.sub(r"<tr>(\s*<td></td>)*\s*</tr>", "", resultado)
    return resultado


def consultar_anexo_sunat(codigo: str, tipo: str) -> AnexoSunat | None:
    """Pagina anexa de la subpartida (ver ANEXOS_SUNAT), con su HTML
    saneado. None si SUNAT dice que la subpartida no existe."""
    accion, titulo = ANEXOS_SUNAT[tipo]
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
            pagina = cliente.get(URL_CONSULTA, params={"accion": accion, "cod_partida": digitos})
            pagina.raise_for_status()
    except httpx.HTTPError as error:
        raise SunatNoDisponibleError(f"No se pudo consultar el portal de SUNAT: {error}") from error

    contenido = pagina.content.decode("latin-1")
    if "Pagina de Errores" in contenido:
        raise SunatNoDisponibleError("SUNAT respondió con su página de error para esta consulta.")
    return AnexoSunat(tipo=tipo, titulo=titulo, html=_sanear(contenido))


URL_CONSOLIDADO_CRITERIOS = "http://www.aduanet.gob.pe/aduanas/infoaduanas/clasifica/consolidado/indice93-2003-1.zip"
URL_RESOLUCIONES_CLASIFICACION = "http://www.aduanet.gob.pe/ol-ad-caInter/regclasInterS01Alias"


def descargar_consolidado_criterios() -> bytes:
    """ZIP del Consolidado de Indice de Criterios de clasificacion (es el
    mismo archivo para toda subpartida). Pasa por el backend porque SUNAT
    solo lo sirve por HTTP y el navegador bloquea esa descarga desde una
    pagina HTTPS."""
    try:
        respuesta = httpx.get(URL_CONSOLIDADO_CRITERIOS, timeout=60, follow_redirects=True)
        respuesta.raise_for_status()
    except httpx.HTTPError as error:
        raise SunatNoDisponibleError(f"No se pudo descargar el consolidado de SUNAT: {error}") from error
    return respuesta.content
