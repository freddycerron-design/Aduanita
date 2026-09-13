"""
Script de una sola vez (re-ejecutable) que descarga el Arancel de Aduanas
del Peru 2022 (D.S. 404-2021-EF, el ultimo publicado por SUNAT con el
anexo completo -- no hay una version estructurada/CSV oficial, solo PDF)
y lo parsea a filas `(codigo, descripcion, ad_valorem)` que se insertan
en la tabla `partidas_arancelarias` (upsert por `codigo`, asi que correr
esto de nuevo con una version mas nueva del PDF actualiza en vez de
duplicar).

Uso:
    python scripts/importar_arancel.py [ruta_pdf_local]

Sin argumento, descarga el PDF de la URL oficial a un archivo temporal.

## Estrategia de parseo (verificada contra el texto real extraido con
## PyMuPDF de varias paginas de muestra del documento real)

El documento es un listado legal con un patron consistente por pagina:
    <numero de pagina>
    NORMAS LEGALES
    <dia de semana, fecha>
    El Peruano
    Codigo
    Designacion de la Mercancia   (o "Descripcion de la Mercancia" en
                                    algunas paginas -- ambos se filtran)
    A/V
    <filas de la tabla...>

Las filas de la tabla siguen esta jerarquia (todos los codigos aparecen
SOLOS en su propia linea):
  - "19.05"              -> partida (4 digitos, HS)
  - "1905.10"             -> subpartida SA (6 digitos)
  - "4802.56.10"          -> subpartida nacional intermedia (8 digitos)
  - "1904.10.00.00"       -> subpartida nacional FINAL (10 digitos) -- es
                             la UNICA que lleva un arancel ad-valorem
                             (un numero solo en su propia linea, ej "0",
                             "6", "11") inmediatamente despues de su
                             descripcion (que puede ocupar varias lineas
                             por el ajuste de texto).

No todo nivel intermedio se imprime siempre: si una subpartida de 6/8
digitos no tiene mas de un desglose nacional, el documento salta
directo de la partida (4 digitos) a la subpartida nacional (10 digitos)
sin imprimir la linea intermedia por separado.

Simplificacion deliberada (aceptada en el plan): la `descripcion`
guardada combina SOLO 2 niveles -- el texto de la partida (4 digitos)
mas reciente + el texto propio que precede inmediatamente al codigo de
10 digitos (que puede venir de una subpartida de 6/8 digitos intermedia,
pero esa jerarquia intermedia en si NO se guarda por separado). Esto
alcanza para que la busqueda de texto completo tenga contexto util sin
necesitar un arbol de jerarquia completo.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import httpx
import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.config import get_supabase_admin_client  # noqa: E402

URL_ARANCEL_2022 = (
    "https://www.sunat.gob.pe/legislacion/procedim/normasadua/gja-04/ctrlCambios/anexos/Arancel_2022.pdf"
)

RE_10 = re.compile(r"^\d{4}\.\d{2}\.\d{2}\.\d{2}$")
RE_8 = re.compile(r"^\d{4}\.\d{2}\.\d{2}$")
RE_6 = re.compile(r"^\d{4}\.\d{2}$")
RE_4 = re.compile(r"^\d{2}\.\d{2}$")
# Cualquiera de los 4 niveles -- OJO, el primer grupo de digitos tiene
# ANCHO DISTINTO segun el nivel (2 digitos solo para la partida "19.05",
# 4 digitos para el resto: "1904.10", "4802.56.10", "1904.10.00.00").
RE_CODIGO = re.compile(r"^(?:\d{2}\.\d{2}|\d{4}\.\d{2}(?:\.\d{2}){0,2})$")
RE_TASA = re.compile(r"^\d+(?:[.,]\d+)?$")

# Lineas de "boilerplate" de pagina que hay que ignorar para que no se
# confundan con codigos/tasas/descripciones reales. La primera linea de
# cada pagina (el numero de pagina) se descarta por POSICION, no por este
# set (ver `_lineas_utiles_de_pagina`).
LINEAS_A_IGNORAR = {
    "NORMAS LEGALES",
    "El Peruano",
    "El Peruano /",
    "Código",
    "Designación de la Mercancía",
    "Descripción de la Mercancia",
    "Descripción de la Mercancía",
    "A/V",
}
_DIAS_SEMANA = ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")


def _normalizar_ligaduras(texto: str) -> str:
    """El PDF usa ligaduras tipograficas Unicode (ﬁ/ﬂ) en vez de 'fi'/'fl'
    sueltos (ej. 'inﬂado', 'codiﬁcacion') -- normalizarlas mejora el
    full-text search, que de otro modo no relaciona 'inflado' (como
    normalmente se escribiria una busqueda) con 'inﬂado'."""
    return texto.replace("ﬁ", "fi").replace("ﬂ", "fl")


def _es_linea_ignorable(linea: str) -> bool:
    linea = linea.strip()
    if not linea:
        return True
    if linea in LINEAS_A_IGNORAR:
        return True
    if linea.startswith(_DIAS_SEMANA):
        return True
    if "El Peruano" in linea:
        return True
    return False


def _lineas_utiles_de_pagina(texto_pagina: str) -> list[str]:
    lineas = texto_pagina.split("\n")
    if lineas:
        lineas = lineas[1:]  # primera linea = numero de pagina, siempre se descarta
    return [_normalizar_ligaduras(l) for l in lineas if not _es_linea_ignorable(l)]  # noqa: E741


def descargar_pdf(destino: Path) -> Path:
    print(f"Descargando {URL_ARANCEL_2022} ...")
    respuesta = httpx.get(URL_ARANCEL_2022, follow_redirects=True, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
    respuesta.raise_for_status()
    destino.write_bytes(respuesta.content)
    print(f"  {len(respuesta.content):,} bytes -> {destino}")
    return destino


def parsear_arancel(ruta_pdf: Path) -> list[dict]:
    doc = fitz.open(str(ruta_pdf))
    filas: list[dict] = []

    descripcion_partida_actual = ""
    codigo_pendiente: str | None = None
    buffer: list[str] = []

    def finalizar_pendiente() -> None:
        nonlocal descripcion_partida_actual
        if codigo_pendiente and RE_4.match(codigo_pendiente):
            descripcion_partida_actual = " ".join(t.strip() for t in buffer if t.strip())
        # Si era 6/8 digitos (o 10 sin tasa, caso raro/roto), se descarta
        # el buffer -- no queda un lugar donde guardarlo en esta version
        # simplificada del parser.

    for pagina in doc:
        for linea in _lineas_utiles_de_pagina(pagina.get_text()):
            texto = linea.strip()

            if RE_CODIGO.match(texto):
                finalizar_pendiente()
                codigo_pendiente = texto
                buffer = []
                continue

            if RE_TASA.match(texto) and codigo_pendiente and RE_10.match(codigo_pendiente):
                descripcion_propia = " ".join(t.strip() for t in buffer if t.strip())
                descripcion_propia = re.sub(r"^[-\s]+", "", descripcion_propia).strip()
                descripcion_completa = (
                    f"{descripcion_partida_actual} - {descripcion_propia}"
                    if descripcion_propia
                    else descripcion_partida_actual
                )
                filas.append(
                    {
                        "codigo": codigo_pendiente,
                        "descripcion": descripcion_completa.strip(" -"),
                        "ad_valorem": float(texto.replace(",", ".")),
                    }
                )
                codigo_pendiente = None
                buffer = []
                continue

            buffer.append(texto)

    doc.close()
    return filas


def cargar_a_supabase(filas: list[dict], tamano_lote: int = 500) -> None:
    admin = get_supabase_admin_client()
    total = len(filas)
    for inicio in range(0, total, tamano_lote):
        lote = filas[inicio : inicio + tamano_lote]
        admin.table("partidas_arancelarias").upsert(lote, on_conflict="codigo").execute()
        print(f"  {min(inicio + tamano_lote, total)}/{total} filas cargadas...")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        ruta = Path(sys.argv[1])
    else:
        ruta = Path(__file__).resolve().parent.parent / ".arancel_2022_cache.pdf"
        if not ruta.exists():
            descargar_pdf(ruta)
        else:
            print(f"Usando PDF ya descargado en {ruta}")

    print("Parseando...")
    filas = parsear_arancel(ruta)
    print(f"{len(filas)} subpartidas nacionales (10 digitos) extraidas.")

    print("Cargando a Supabase (upsert por codigo)...")
    cargar_a_supabase(filas)
    print("Listo.")
