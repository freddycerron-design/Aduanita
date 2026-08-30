"""
Dashboard Streamlit de AduANITA: interfaz de trabajo del especialista
aduanero.

Layout split-screen: documentos extraidos (izquierda) vs. discrepancias,
propuesta de clasificacion, borrador de correo y decision (derecha).

Se conecta al backend FastAPI (API_BASE_URL) para todo el pipeline, y
directamente a Supabase Auth solo para el login del especialista y para
previsualizar los PDFs originales guardados en Supabase Storage.
"""
from __future__ import annotations

import html
import os

import httpx
import streamlit as st
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "documentos-aduaneros")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")

TIPOS_DOCUMENTO = ["FACTURA", "SEGURO", "SWIFT_BANCARIO", "BL"]

st.set_page_config(page_title="AduANITA", page_icon="📦", layout="wide")


# ---------------------------------------------------------------------
# Estilos: tema "mesa de cartas nauticas" -- fondo oscuro tipo carta de
# navegacion, con los documentos (tarjetas de datos, inputs) en tono papel
# de manifiesto. Los colores base (fondo, superficie secundaria, acento)
# se definen en .streamlit/config.toml; aqui se agrega la tipografia real
# (config.toml solo permite "sans serif"/"serif"/"monospace" genericos) y
# los componentes custom: renglones de discrepancia tipo libro contable,
# tarjeta hero de clasificacion, y encabezado tipo carta para el correo.
# ---------------------------------------------------------------------

_CSS_ADUANITA = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
}
h1, h2, h3 {
    font-family: 'Fraunces', serif !important;
    letter-spacing: -0.01em;
}
.mono {
    font-family: 'IBM Plex Mono', monospace;
}

/* Sidebar y widgets nativos viven sobre secondaryBackgroundColor (papel) */
[data-testid="stSidebar"] {
    border-right: 1px solid #1E2E3D;
}
[data-testid="stSidebar"] * {
    color: #1B1B16 !important;
}
[data-testid="stTextInput"] input,
[data-testid="stTextArea"] textarea {
    font-family: 'Inter', sans-serif !important;
}

/* Header del despacho */
.despacho-header {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
    margin-bottom: 0.15rem;
}
.despacho-numero {
    font-size: 1.7rem;
    font-weight: 600;
    color: #D8A857;
}
.despacho-cliente {
    color: #9AA5AD;
    margin-bottom: 1.1rem;
}
.status-badge {
    display: inline-block;
    padding: 0.15rem 0.65rem;
    border: 1px solid #B8863B;
    border-radius: 3px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #D8A857;
}

/* Renglones de discrepancia, estilo libro de manifiesto */
.ledger-row {
    display: flex;
    gap: 0.9rem;
    align-items: flex-start;
    padding: 0.6rem 0;
    border-top: 1px solid #24384A;
}
.ledger-row:last-of-type {
    border-bottom: 1px solid #24384A;
}
.ledger-chip {
    flex-shrink: 0;
    margin-top: 0.15rem;
    padding: 0.1rem 0.55rem;
    border-radius: 2px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #101A24;
    text-transform: uppercase;
    white-space: nowrap;
}
.ledger-row--ALTA .ledger-chip { background: #C24B3E; }
.ledger-row--MEDIA .ledger-chip { background: #C79A45; }
.ledger-row--NINGUNA .ledger-chip { background: #4F8467; }
.ledger-row-body {
    font-size: 0.92rem;
    line-height: 1.45;
    color: #EDE7D8;
}
.ledger-row-body b { color: #ffffff; }

/* Tarjeta hero de clasificacion arancelaria */
.classification-hero {
    background: #F4EFE1;
    color: #1B1B16;
    border-radius: 3px;
    padding: 1.1rem 1.3rem;
    margin-bottom: 0.9rem;
}
.classification-hero .subpartida {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 2rem;
    font-weight: 600;
}
.confidence-chip {
    display: inline-block;
    margin-left: 0.6rem;
    padding: 0.18rem 0.6rem;
    border-radius: 2px;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
    color: #F4EFE1;
}
.confidence-chip--ALTA { background: #3F6E52; }
.confidence-chip--MEDIA { background: #A87A2E; }
.confidence-chip--BAJA { background: #B23A2E; }
.classification-hero .sustento {
    margin-top: 0.65rem;
    font-size: 0.85rem;
    line-height: 1.5;
    color: #5A5648;
}

/* Encabezado tipo carta para el borrador de correo */
.letter-header {
    background: #F4EFE1;
    color: #1B1B16;
    padding: 0.7rem 1.1rem;
    border-radius: 3px 3px 0 0;
    border-bottom: 2px solid #B8863B;
    font-family: 'Fraunces', serif;
    font-size: 0.95rem;
}
</style>
"""


def _inyectar_estilos() -> None:
    st.markdown(_CSS_ADUANITA, unsafe_allow_html=True)


_inyectar_estilos()


# ---------------------------------------------------------------------
# Cliente Supabase (uno por sesion de navegador, NO compartido entre
# usuarios: st.cache_resource seria global a toda la app y mezclaria
# las sesiones de distintos especialistas logueados al mismo tiempo).
# ---------------------------------------------------------------------

def get_supabase_client() -> Client:
    if "supabase_client" not in st.session_state:
        st.session_state["supabase_client"] = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return st.session_state["supabase_client"]


# ---------------------------------------------------------------------
# Cliente HTTP hacia el backend FastAPI
# ---------------------------------------------------------------------

def _api_headers() -> dict:
    return {"Authorization": f"Bearer {st.session_state['access_token']}"}


def _peticion(metodo: str, path: str, **kwargs) -> dict | list | None:
    """Ejecuta una peticion HTTP contra el backend y maneja errores de
    forma centralizada (muestra st.error y devuelve None) para que el
    resto del dashboard no tenga que repetir try/except en cada llamada."""
    try:
        respuesta = httpx.request(
            metodo, f"{API_BASE_URL}{path}", headers=_api_headers(), timeout=120, **kwargs
        )
        respuesta.raise_for_status()
        return respuesta.json() if respuesta.content else None
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 401:
            # El token de sesion de Supabase expiro (por defecto dura ~1
            # hora) o es invalido. En vez de mostrar el error crudo, se
            # cierra la sesion local y se manda de vuelta al login.
            st.session_state.clear()
            st.warning("Tu sesion expiro. Vuelve a iniciar sesion.")
            st.rerun()
        detalle = error.response.text
        try:
            detalle = error.response.json().get("detail", detalle)
        except Exception:
            pass
        st.error(f"Error del backend ({error.response.status_code}): {detalle}")
    except httpx.RequestError as error:
        st.error(f"No se pudo conectar con el backend en {API_BASE_URL}: {error}")
    return None


def api_get(path: str, **params) -> dict | list | None:
    return _peticion("GET", path, params=params)


def api_post(path: str, json_body: dict | None = None, files=None, data=None) -> dict | list | None:
    return _peticion("POST", path, json=json_body, files=files, data=data)


def api_patch(path: str, json_body: dict) -> dict | list | None:
    return _peticion("PATCH", path, json=json_body)


def obtener_pdf_bytes(path_storage: str) -> bytes | None:
    try:
        return get_supabase_client().storage.from_(SUPABASE_STORAGE_BUCKET).download(path_storage)
    except Exception as error:
        st.warning(f"No se pudo cargar la vista previa del PDF: {error}")
        return None


# ---------------------------------------------------------------------
# Pantalla de login
# ---------------------------------------------------------------------

def pantalla_login() -> None:
    st.title("📦 AduANITA")
    st.caption("Automatizacion de revision documental aduanera y clasificacion arancelaria asistida.")

    with st.form("login_form"):
        email = st.text_input("Correo electronico")
        password = st.text_input("Contrasena", type="password")
        enviado = st.form_submit_button("Ingresar")

    if enviado:
        try:
            resultado = get_supabase_client().auth.sign_in_with_password(
                {"email": email, "password": password}
            )
        except Exception as error:
            st.error(f"No se pudo iniciar sesion: {error}")
        else:
            st.session_state["access_token"] = resultado.session.access_token
            st.session_state["user_id"] = resultado.user.id
            st.session_state["user_email"] = resultado.user.email
            st.rerun()

    st.stop()


if "access_token" not in st.session_state:
    pantalla_login()


# ---------------------------------------------------------------------
# Sidebar: sesion + seleccion/alta de despacho
# ---------------------------------------------------------------------

with st.sidebar:
    st.write(f"👤 {st.session_state['user_email']}")
    if st.button("Cerrar sesion"):
        try:
            get_supabase_client().auth.sign_out()
        except Exception:
            pass
        st.session_state.clear()
        st.rerun()

    st.divider()
    st.subheader("Despachos")

    despachos = api_get("/despachos") or []
    # Se indexa por id (estable) en vez de por la etiqueta visible, porque
    # la etiqueta incluye el estado del despacho: si dependieramos del
    # texto para recordar la seleccion, cada accion que cambia el estado
    # (subir un documento, validar, clasificar...) haria que Streamlit no
    # reconozca la opcion anterior tras el rerun y reinicie la seleccion.
    etiquetas_por_id = {
        d["id"]: f"{d['numero_despacho']} · {d['cliente']} ({d['estado']})" for d in despachos
    }
    ids_ordenados = list(etiquetas_por_id.keys())
    etiquetas = ["➕ Nuevo despacho"] + [etiquetas_por_id[i] for i in ids_ordenados]

    id_actual = st.session_state.get("id_despacho_actual")
    indice_defecto = (ids_ordenados.index(id_actual) + 1) if id_actual in ids_ordenados else 0

    etiqueta_seleccionada = st.selectbox("Selecciona un despacho", etiquetas, index=indice_defecto)

    if etiqueta_seleccionada == "➕ Nuevo despacho":
        with st.form("nuevo_despacho_form"):
            numero = st.text_input("Numero de despacho")
            cliente = st.text_input("Cliente")
            crear = st.form_submit_button("Crear despacho")
        if crear:
            if not numero or not cliente:
                st.error("Numero de despacho y cliente son obligatorios.")
            else:
                nuevo = api_post("/despachos", json_body={"numero_despacho": numero, "cliente": cliente})
                if nuevo:
                    st.session_state["id_despacho_actual"] = nuevo["id"]
                    st.rerun()
        st.stop()

    st.session_state["id_despacho_actual"] = ids_ordenados[etiquetas.index(etiqueta_seleccionada) - 1]

    if st.button("🔄 Refrescar"):
        st.rerun()


# ---------------------------------------------------------------------
# Contenido principal del despacho seleccionado
# ---------------------------------------------------------------------

id_despacho = st.session_state.get("id_despacho_actual")
if not id_despacho:
    st.info("Selecciona o crea un despacho en la barra lateral para comenzar.")
    st.stop()

detalle = api_get(f"/despachos/{id_despacho}")
if not detalle:
    st.stop()

despacho_info = detalle["despacho"]
# Los valores de numero_despacho/cliente son texto libre ingresado por el
# especialista; se escapan antes de inyectarlos como HTML crudo.
_numero_html = html.escape(despacho_info["numero_despacho"])
_cliente_html = html.escape(despacho_info["cliente"])
_estado_html = html.escape(despacho_info["estado"])
st.markdown(
    f"""
    <div class="despacho-header">
        <span class="despacho-numero mono">{_numero_html}</span>
        <span class="status-badge">{_estado_html}</span>
    </div>
    <div class="despacho-cliente">Cliente: {_cliente_html}</div>
    """,
    unsafe_allow_html=True,
)

documentos_por_tipo = {d["tipo_documento"]: d for d in detalle["documentos"]}

# --- Carga de documentos ---------------------------------------------------
# El backend solo exige FACTURA + BL como minimo para /validar (ver
# app.main._ejecutar_validacion); SEGURO y SWIFT_BANCARIO son opcionales y
# solo habilitan reglas de validacion adicionales.
documentos_minimos_ok = {"FACTURA", "BL"}.issubset(documentos_por_tipo.keys())

with st.expander("📤 Carga de documentos", expanded=not documentos_minimos_ok):
    columnas = st.columns(4)
    for columna, tipo in zip(columnas, TIPOS_DOCUMENTO):
        with columna:
            cargado = tipo in documentos_por_tipo
            st.markdown(f"**{tipo}** {'✅' if cargado else '⬜'}")
            archivo = st.file_uploader(f"PDF {tipo}", type="pdf", key=f"upload_{tipo}", label_visibility="collapsed")
            if archivo is not None and st.button(f"Subir {tipo}", key=f"btn_upload_{tipo}"):
                with st.spinner(f"Extrayendo datos de {tipo}..."):
                    resultado = api_post(
                        f"/despachos/{id_despacho}/documentos",
                        data={"tipo_documento": tipo},
                        files={"archivo": (archivo.name, archivo.getvalue(), "application/pdf")},
                    )
                if resultado:
                    st.success(f"{tipo} procesado correctamente.")
                    st.rerun()

    if documentos_minimos_ok:
        faltantes_opcionales = {"SEGURO", "SWIFT_BANCARIO"} - documentos_por_tipo.keys()
        if faltantes_opcionales:
            st.caption(
                f"Falta(n) {', '.join(sorted(faltantes_opcionales))} (opcional): esas validaciones "
                f"cruzadas quedaran marcadas como 'no verificable' hasta que los cargues."
            )
        if st.button("▶️ Ejecutar pipeline completo (validar + clasificar + borrador)", type="primary"):
            with st.spinner("Ejecutando validaciones, clasificacion y borrador de correo..."):
                resultado = api_post(f"/pipeline/{id_despacho}/ejecutar-completo")
            if resultado:
                st.success("Pipeline ejecutado correctamente.")
                st.rerun()
    else:
        st.info("Carga al menos Factura y BL para poder ejecutar el pipeline (Seguro y SWIFT son opcionales).")

st.divider()

col_izquierda, col_derecha = st.columns(2)

# --- Columna izquierda: documentos extraidos --------------------------------
with col_izquierda:
    st.subheader("📄 Documentos extraidos")
    tabs = st.tabs(TIPOS_DOCUMENTO)
    for tab, tipo in zip(tabs, TIPOS_DOCUMENTO):
        with tab:
            doc = documentos_por_tipo.get(tipo)
            if not doc:
                st.info(f"Aun no se ha cargado el documento {tipo}.")
                continue

            metodo = doc["metodo_extraccion"]
            icono = "🔎 OCR/Vision (PDF escaneado)" if metodo == "GEMINI_VISION" else "📝 Texto digital"
            st.caption(f"Metodo de extraccion: {icono}")
            st.json(doc["contenido_json"])

            pdf_bytes = obtener_pdf_bytes(doc["url_pdf_storage"])
            if pdf_bytes:
                st.download_button(
                    f"⬇️ Descargar PDF original",
                    data=pdf_bytes,
                    file_name=f"{despacho_info['numero_despacho']}_{tipo}.pdf",
                    mime="application/pdf",
                    key=f"descarga_{tipo}",
                )

# --- Columna derecha: validaciones, clasificacion, correo, decision --------
with col_derecha:
    st.subheader("🔍 Alertas de discrepancias")
    validaciones = detalle.get("validaciones") or []
    if not validaciones:
        st.info("Aun no se han ejecutado las validaciones para este despacho.")
    else:
        # regla es un identificador fijo (services/validation_engine.py); el
        # detalle interpola texto extraido de los PDF por Gemini (nombres,
        # montos), por lo que se escapa antes de inyectarlo como HTML.
        filas = [
            f'<div class="ledger-row ledger-row--{v["severidad"]}">'
            f'<span class="ledger-chip">{v["severidad"]}</span>'
            f'<span class="ledger-row-body"><b>{html.escape(v["regla"])}</b> — {html.escape(v["detalle"])}</span>'
            f"</div>"
            for v in validaciones
        ]
        st.markdown("".join(filas), unsafe_allow_html=True)

    st.subheader("📦 Propuesta de partida arancelaria")
    clasificacion = detalle.get("clasificacion")
    if not clasificacion:
        st.info("Aun no se ha ejecutado la clasificacion para este despacho.")
    else:
        # subpartida_sugerida es un codigo controlado (Pydantic), pero
        # sustento_legal_rgi es texto libre generado por Gemini -> se escapa.
        _subpartida_html = html.escape(clasificacion["subpartida_sugerida"])
        _confianza = clasificacion["nivel_confianza"]
        _sustento_html = html.escape(clasificacion["sustento_legal_rgi"])
        st.markdown(
            f"""
            <div class="classification-hero">
                <span class="subpartida">{_subpartida_html}</span>
                <span class="confidence-chip confidence-chip--{_confianza}">{_confianza}</span>
                <div class="sustento"><b>Sustento legal (RGI):</b> {_sustento_html}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        if clasificacion["informacion_faltante_alert"]:
            st.warning(
                "Informacion faltante para elevar la confianza:\n"
                + "\n".join(f"- {i}" for i in clasificacion["informacion_faltante_alert"])
            )

    st.subheader("✉️ Borrador de correo")
    borrador = detalle.get("borrador")
    if not borrador:
        st.info("Aun no se ha generado un borrador de correo para este despacho.")
    else:
        st.markdown(
            f'<div class="letter-header">✉️ {html.escape(borrador["asunto"])}</div>',
            unsafe_allow_html=True,
        )
        cuerpo_actual = borrador.get("cuerpo_editado") or borrador["cuerpo"]
        nuevo_cuerpo = st.text_area(
            "Cuerpo (editable)", value=cuerpo_actual, height=260, key="cuerpo_borrador", label_visibility="collapsed"
        )
        st.caption("Este correo no se envia automaticamente: copialo y envialo desde tu cliente de correo habitual.")
        if st.button("💾 Guardar edicion del borrador"):
            actualizado = api_patch(f"/borradores/{borrador['id']}", {"cuerpo_editado": nuevo_cuerpo})
            if actualizado:
                st.success("Borrador actualizado.")
                st.rerun()

    st.subheader("✅ Decision del especialista")
    factura_doc = documentos_por_tipo.get("FACTURA")

    if not clasificacion:
        st.info("Debes ejecutar la clasificacion antes de poder aprobar o corregir la propuesta.")
    elif despacho_info["estado"] in ("APROBADO", "CORREGIDO"):
        st.success(f"Este despacho ya fue marcado como **{despacho_info['estado']}**.")
    else:
        accion_label = st.radio(
            "Decision sobre la propuesta de la IA", ["Aprobar partida", "Corregir partida"], key="accion_decision"
        )
        subpartida_final = clasificacion["subpartida_sugerida"]
        motivo = None
        if accion_label == "Corregir partida":
            subpartida_final = st.text_input(
                "Subpartida corregida", value=clasificacion["subpartida_sugerida"], key="subpartida_corregida"
            )
            motivo = st.text_area("Motivo de la correccion (obligatorio)", key="motivo_correccion")

        if st.button("Confirmar decision", type="primary"):
            if accion_label == "Corregir partida" and not (motivo and motivo.strip()):
                st.error("Debes indicar el motivo de la correccion.")
            else:
                descripcion_comercial = (
                    factura_doc["contenido_json"].get("descripcion_mercancia", "") if factura_doc else ""
                )
                atributos = {
                    "incoterm": factura_doc["contenido_json"].get("incoterm") if factura_doc else None,
                }
                cuerpo_decision = {
                    "accion": "APROBADO" if accion_label == "Aprobar partida" else "EDITADO",
                    "subpartida_sugerida_ia": clasificacion["subpartida_sugerida"],
                    "subpartida_final": subpartida_final,
                    "descripcion_comercial": descripcion_comercial,
                    "atributos": atributos,
                    "motivo_modificacion": motivo,
                }
                resultado = api_post(f"/despachos/{id_despacho}/decision", json_body=cuerpo_decision)
                if resultado:
                    st.success("Decision registrada. El RAG fue actualizado con este feedback.")
                    st.rerun()
