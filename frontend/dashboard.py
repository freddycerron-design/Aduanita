"""
Dashboard Streamlit de AduANITA: interfaz de trabajo del especialista y del
liquidador aduanero.

Layout tipo IDE: una barra de iconos siempre visible a la izquierda (panel
"Archivos" = explorador de despachos agrupados por estado, panel "Cuenta"
= sesion/rol/logout) y el contenido principal en 3 tabs: Revision (carga de
documentos + discrepancias + visor JSON/PDF), Clasificacion (propuesta IA +
decision del liquidador) y Correo (borrador editable).

Se conecta al backend FastAPI (API_BASE_URL) para todo el pipeline, y
directamente a Supabase Auth solo para el login y para previsualizar los
PDFs originales guardados en Supabase Storage.
"""
from __future__ import annotations

import base64
import html
import os
from pathlib import Path

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

# Assets de marca. Rutas resueltas relativas a este archivo (no al cwd),
# para que funcionen sin importar desde donde se lance `streamlit run`.
ASSETS_DIR = Path(__file__).parent / "assets"
LOGO_PATH = ASSETS_DIR / "logo_aduanita.png"
FAVICON_PATH = ASSETS_DIR / "favicon_aduanita.png"

# Estados del despacho (ver app/main.py) y su etiqueta/grupo en el Explorer.
GRUPOS_ESTADO = [
    ("REVISION_DOC", "📋 Revisión Doc."),
    ("CLASIFICACION", "🏷️ Clasificación"),
    ("REVISADO", "✅ Revisados"),
    ("OBSERVADO", "⚠️ Observados"),
]

st.set_page_config(
    page_title="AduANITA",
    page_icon=str(FAVICON_PATH) if FAVICON_PATH.exists() else "📦",
    layout="wide",
)


# ---------------------------------------------------------------------
# Estilos: paleta navy + coral (tomada de EstimaDORA, app hermana). Los
# colores base se definen en .streamlit/config.toml; aqui se agrega la
# tipografia real y los componentes custom (renglones de discrepancia,
# tarjeta hero de clasificacion, encabezado tipo carta para el correo).
# ---------------------------------------------------------------------

_CSS_ADUANITA = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root {
    --bg: #10141C;
    --surface: #171B2C;
    --surface-border: #262B40;
    --coral: #E2583E;
    --indigo: #2E2F5C;
    --amber: #E0A83E;
    --verde: #3FA36B;
    --rojo: #DF4C3A;
    --texto: #F4F5F7;
    --texto-secundario: #93A0B4;
}

html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
}
h1, h2, h3, h4, h5 {
    font-family: 'Inter', sans-serif !important;
    font-weight: 700 !important;
    letter-spacing: -0.01em;
}
.mono {
    font-family: 'IBM Plex Mono', monospace;
}

[data-testid="stSidebar"] {
    background: var(--surface);
    border-right: 1px solid var(--surface-border);
}

[data-testid="stTextInput"] input,
[data-testid="stTextArea"] textarea,
[data-testid="stSelectbox"] * {
    font-family: 'Inter', sans-serif !important;
}

/* Botones tipo "pill" (completamente redondeados) */
.stButton > button,
[data-testid="stFormSubmitButton"] button,
[data-testid="stDownloadButton"] button {
    border-radius: 999px !important;
    font-weight: 600 !important;
}
/* Barra de iconos: botones cuadrados, no pill */
.icon-rail .stButton > button {
    border-radius: 10px !important;
    font-size: 1.1rem !important;
    padding: 0.4rem !important;
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
    font-weight: 700;
    color: var(--coral);
}
.despacho-cliente {
    color: var(--texto-secundario);
    margin-bottom: 1.1rem;
}
.status-badge {
    display: inline-block;
    padding: 0.2rem 0.8rem;
    background: var(--amber);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #241A05;
}

/* Renglones de discrepancia */
.ledger-row {
    display: flex;
    gap: 0.9rem;
    align-items: flex-start;
    padding: 0.65rem 0.9rem;
    margin-bottom: 0.4rem;
    background: var(--bg);
    border: 1px solid var(--surface-border);
    border-radius: 12px;
}
.ledger-chip {
    flex-shrink: 0;
    margin-top: 0.1rem;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #ffffff;
    text-transform: uppercase;
    white-space: nowrap;
}
.ledger-row--ALTA .ledger-chip { background: var(--rojo); }
.ledger-row--MEDIA .ledger-chip { background: var(--amber); color: #241A05; }
.ledger-row--NINGUNA .ledger-chip { background: var(--verde); }
.ledger-row-body {
    font-size: 0.92rem;
    line-height: 1.45;
    color: var(--texto);
}
.ledger-row-body b { color: #ffffff; }

/* Tarjeta hero de clasificacion arancelaria */
.classification-hero {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    color: var(--texto);
    border-radius: 14px;
    padding: 1.1rem 1.3rem;
    margin-bottom: 0.9rem;
}
.classification-hero .subpartida {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 2rem;
    font-weight: 600;
    color: var(--coral);
}
.confidence-chip {
    display: inline-block;
    margin-left: 0.6rem;
    padding: 0.2rem 0.7rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
    color: #ffffff;
}
.confidence-chip--ALTA { background: var(--verde); }
.confidence-chip--MEDIA { background: var(--amber); color: #241A05; }
.confidence-chip--BAJA { background: var(--rojo); }
.classification-hero .sustento {
    margin-top: 0.65rem;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--texto-secundario);
}

/* Encabezado tipo carta para el borrador de correo */
.letter-header {
    background: var(--surface);
    color: var(--texto);
    padding: 0.75rem 1.1rem;
    border: 1px solid var(--surface-border);
    border-bottom: 2px solid var(--coral);
    border-radius: 14px 14px 0 0;
    font-weight: 600;
    font-size: 0.95rem;
}

/* Numeros de orden en las pestanas del contenido principal (circulo
   naranja, numero blanco) -- se dibujan con ::before sobre los botones
   de pestana de BaseWeb, no se puede inyectar HTML dentro del label de
   st.tabs directamente. */
[data-testid="stTabs"] [data-baseweb="tab-list"] button::before {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-right: 0.4rem;
    border-radius: 50%;
    background: var(--coral);
    color: #ffffff;
    font-size: 0.72rem;
    font-weight: 700;
    vertical-align: middle;
}
[data-testid="stTabs"] [data-baseweb="tab-list"] button:nth-of-type(1)::before { content: "1"; }
[data-testid="stTabs"] [data-baseweb="tab-list"] button:nth-of-type(2)::before { content: "2"; }
[data-testid="stTabs"] [data-baseweb="tab-list"] button:nth-of-type(3)::before { content: "3"; }

/* Badge de rol en el panel de cuenta */
.rol-badge {
    display: inline-block;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--coral);
    color: var(--coral);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
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


def api_delete(path: str) -> dict | list | None:
    return _peticion("DELETE", path)


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
    # La app usa layout="wide" para el dashboard; el login se centra en una
    # columna angosta en vez de estirarse a todo el ancho de la pantalla.
    _, columna_central, _ = st.columns([1, 1.1, 1])
    with columna_central:
        if LOGO_PATH.exists():
            st.image(str(LOGO_PATH), width=320)
        else:
            st.title("📦 AduANITA")
        st.caption("Automatizacion de revision documental aduanera y clasificacion arancelaria asistida.")

        with st.form("login_form"):
            email = st.text_input("Correo electronico")
            password = st.text_input("Contrasena", type="password")
            enviado = st.form_submit_button("Ingresar", use_container_width=True)

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
                # El rol (ESPECIALISTA/LIQUIDADOR/ADMIN) determina que
                # acciones puede tomar en el flujo -- se lee 1 sola vez al
                # loguearse desde perfiles_especialista (RLS permite a
                # cualquier autenticado leer esa tabla).
                try:
                    perfil = (
                        get_supabase_client()
                        .table("perfiles_especialista")
                        .select("rol")
                        .eq("id", resultado.user.id)
                        .execute()
                    )
                    st.session_state["user_rol"] = perfil.data[0]["rol"] if perfil.data else "ESPECIALISTA"
                except Exception:
                    st.session_state["user_rol"] = "ESPECIALISTA"
                st.rerun()

    st.stop()


if "access_token" not in st.session_state:
    pantalla_login()

USER_ROL = st.session_state.get("user_rol", "ESPECIALISTA")
PUEDE_ENVIAR_A_CLASIFICACION = USER_ROL in ("ESPECIALISTA", "ADMIN")
PUEDE_DECIDIR_CLASIFICACION = USER_ROL in ("LIQUIDADOR", "ADMIN")


# ---------------------------------------------------------------------
# Barra de iconos (siempre visible) + panel activo del Explorer
# ---------------------------------------------------------------------

with st.sidebar:
    if LOGO_PATH.exists():
        st.image(str(LOGO_PATH), width=170)
    st.markdown('<div class="icon-rail">', unsafe_allow_html=True)
    col_icono_1, col_icono_2 = st.columns(2)
    with col_icono_1:
        if st.button("📁", key="icono_archivos", help="Despachos", use_container_width=True):
            st.session_state["panel_activo"] = "archivos"
    with col_icono_2:
        if st.button("👤", key="icono_cuenta", help="Cuenta", use_container_width=True):
            st.session_state["panel_activo"] = "cuenta"
    st.markdown("</div>", unsafe_allow_html=True)

    panel_activo = st.session_state.get("panel_activo", "archivos")
    st.divider()

    if panel_activo == "cuenta":
        st.subheader("Cuenta")
        st.write(f"👤 {st.session_state['user_email']}")
        st.markdown(f'<span class="rol-badge">{html.escape(USER_ROL)}</span>', unsafe_allow_html=True)
        st.caption(
            "El rol define que acciones puedes tomar: el especialista sube "
            "documentos y envia a clasificacion; el liquidador acepta u "
            "observa la propuesta de subpartida."
        )
        st.divider()
        if st.button("Cerrar sesion", use_container_width=True):
            try:
                get_supabase_client().auth.sign_out()
            except Exception:
                pass
            st.session_state.clear()
            st.rerun()

    else:
        st.subheader("Explorer")

        if st.button("➕ Nuevo despacho", use_container_width=True):
            st.session_state["mostrar_form_nuevo"] = not st.session_state.get("mostrar_form_nuevo", False)

        if st.session_state.get("mostrar_form_nuevo"):
            with st.form("nuevo_despacho_form"):
                numero = st.text_input("Numero de despacho")
                cliente = st.text_input("Cliente")
                crear = st.form_submit_button("Crear despacho", use_container_width=True)
            if crear:
                if not numero or not cliente:
                    st.error("Numero de despacho y cliente son obligatorios.")
                else:
                    nuevo = api_post("/despachos", json_body={"numero_despacho": numero, "cliente": cliente})
                    if nuevo:
                        st.session_state["id_despacho_actual"] = nuevo["id"]
                        st.session_state["mostrar_form_nuevo"] = False
                        st.rerun()

        busqueda = st.text_input("🔍 Buscar por número", key="busqueda_despacho", label_visibility="collapsed", placeholder="🔍 Buscar por número")

        despachos = api_get("/despachos") or []
        if busqueda:
            despachos = [d for d in despachos if busqueda.strip().lower() in d["numero_despacho"].lower()]

        id_actual = st.session_state.get("id_despacho_actual")
        for estado_valor, etiqueta in GRUPOS_ESTADO:
            grupo = [d for d in despachos if d["estado"] == estado_valor]
            grupo_activo = any(d["id"] == id_actual for d in grupo)
            with st.expander(f"{etiqueta} ({len(grupo)})", expanded=bool(grupo) or grupo_activo):
                if not grupo:
                    st.caption("Sin despachos.")
                for d in grupo:
                    seleccionado = d["id"] == id_actual
                    if st.button(
                        f"{'▶ ' if seleccionado else ''}{d['numero_despacho']} · {d['cliente']}",
                        key=f"despacho_btn_{d['id']}",
                        use_container_width=True,
                        type="primary" if seleccionado else "secondary",
                    ):
                        st.session_state["id_despacho_actual"] = d["id"]
                        st.rerun()


# ---------------------------------------------------------------------
# Contenido principal del despacho seleccionado
# ---------------------------------------------------------------------

id_despacho = st.session_state.get("id_despacho_actual")
if not id_despacho:
    st.info("Selecciona o crea un despacho en el panel Explorer (icono 📁 de la izquierda) para comenzar.")
    st.stop()

detalle = api_get(f"/despachos/{id_despacho}")
if not detalle:
    st.stop()

despacho_info = detalle["despacho"]
estado_actual = despacho_info["estado"]
# Los valores de numero_despacho/cliente son texto libre ingresado por el
# especialista; se escapan antes de inyectarlos como HTML crudo.
_numero_html = html.escape(despacho_info["numero_despacho"])
_cliente_html = html.escape(despacho_info["cliente"])
_estado_html = html.escape(estado_actual)
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
validaciones = detalle.get("validaciones") or []
clasificacion = detalle.get("clasificacion")
borrador = detalle.get("borrador")
documentos_minimos_ok = {"FACTURA", "BL"}.issubset(documentos_por_tipo.keys())

tab_revision, tab_clasificacion, tab_correo = st.tabs(["Revisión", "Clasificación", "Correo"])

# --- Tab 1: carga de documentos + discrepancias (mitad superior) y  --------
# --- visor JSON/PDF elegido por el usuario (mitad inferior) ----------------
with tab_revision:
    with st.container(height=430, border=False):
        st.markdown("##### 📤 Documentos")
        st.caption(
            "Cargar solo sube el PDF (rapido, sin extraer datos todavia). Cuando termines, presiona "
            "'Procesar información' para extraer, validar y clasificar todo de una vez."
        )
        columnas = st.columns(4)
        for columna, tipo in zip(columnas, TIPOS_DOCUMENTO):
            with columna:
                doc_actual = documentos_por_tipo.get(tipo)
                cargado = doc_actual is not None
                procesado = bool(doc_actual and doc_actual.get("procesado"))
                icono = "✅" if procesado else ("📄" if cargado else "⬜")
                st.markdown(f"**{tipo}** {icono}")

                archivo = st.file_uploader(
                    f"PDF {tipo}", type="pdf", key=f"upload_{tipo}", label_visibility="collapsed"
                )

                if archivo is not None:
                    # Se sube en cuanto se selecciona un archivo, sea la
                    # primera carga o un reemplazo (el backend hace upsert,
                    # asi que un PDF nuevo del mismo tipo sobrescribe al
                    # anterior sin necesidad de eliminarlo primero). Se usa
                    # el file_id para no volver a subir el mismo archivo en
                    # cada rerun posterior mientras siga seleccionado.
                    clave_ultimo_subido = f"ultimo_subido_{tipo}"
                    if st.session_state.get(clave_ultimo_subido) != archivo.file_id:
                        with st.spinner(f"Subiendo {tipo}..."):
                            resultado = api_post(
                                f"/despachos/{id_despacho}/documentos",
                                data={"tipo_documento": tipo},
                                files={"archivo": (archivo.name, archivo.getvalue(), "application/pdf")},
                            )
                        if resultado:
                            st.session_state[clave_ultimo_subido] = archivo.file_id
                            st.success(f"{tipo} cargado.")
                            st.rerun()

                if cargado and st.button(f"🗑️ Eliminar", key=f"btn_delete_{tipo}", use_container_width=True):
                    if api_delete(f"/despachos/{id_despacho}/documentos/{tipo}") is not None:
                        st.session_state.pop(f"ultimo_subido_{tipo}", None)
                        st.rerun()

        st.divider()
        if estado_actual != "REVISION_DOC":
            st.caption(f"Este despacho ya fue procesado (estado actual: {estado_actual}).")
        elif not PUEDE_ENVIAR_A_CLASIFICACION:
            st.caption("Solo un especialista puede procesar este despacho.")
        else:
            if st.button(
                "⚙️ Procesar información",
                type="primary",
                use_container_width=True,
                disabled=not documentos_minimos_ok,
                help=None if documentos_minimos_ok else "Carga al menos Factura y BL primero.",
            ):
                with st.spinner("Extrayendo datos, validando y clasificando... puede tardar unos segundos por documento."):
                    resultado = api_post(f"/despachos/{id_despacho}/enviar-a-clasificacion")
                if resultado:
                    st.success("Procesamiento completo. Revisa la pestaña Clasificación.")
                    st.rerun()

        st.divider()
        st.markdown("##### 🔍 Discrepancias")
        if not documentos_minimos_ok:
            st.info("Carga al menos Factura y BL para poder validar (Seguro y SWIFT son opcionales).")
        elif not validaciones:
            st.caption("Aun no se ha ejecutado la validacion. Se genera al presionar 'Procesar información'.")
        else:
            # regla es un identificador fijo (services/validation_engine.py);
            # el detalle interpola texto extraido por Gemini -> se escapa.
            filas = [
                f'<div class="ledger-row ledger-row--{v["severidad"]}">'
                f'<span class="ledger-chip">{v["severidad"]}</span>'
                f'<span class="ledger-row-body"><b>{html.escape(v["regla"])}</b> — {html.escape(v["detalle"])}</span>'
                f"</div>"
                for v in validaciones
            ]
            st.markdown("".join(filas), unsafe_allow_html=True)

    st.divider()
    st.markdown("##### 👁️ Visor de documentos")
    col_selector, col_modo = st.columns([2, 1])
    with col_selector:
        tipo_visor = st.selectbox("Documento", TIPOS_DOCUMENTO, key="visor_tipo_doc", label_visibility="collapsed")
    with col_modo:
        modo_visor = st.radio(
            "Ver como", ["JSON", "PDF"], key="visor_modo", horizontal=True, label_visibility="collapsed"
        )

    doc_visor = documentos_por_tipo.get(tipo_visor)
    if not doc_visor:
        st.info(f"Aun no se ha cargado el documento {tipo_visor}.")
    elif modo_visor == "JSON" and not doc_visor.get("procesado"):
        st.info(f"{tipo_visor} esta cargado pero aun no procesado. Presiona 'Procesar información' para extraer sus datos.")
    elif modo_visor == "JSON":
        metodo = doc_visor["metodo_extraccion"]
        icono = "🔎 OCR/Vision (PDF escaneado)" if metodo == "GEMINI_VISION" else "📝 Texto digital"
        st.caption(f"Metodo de extraccion: {icono}")
        st.json(doc_visor["contenido_json"])
    else:
        pdf_bytes = obtener_pdf_bytes(doc_visor["url_pdf_storage"])
        if pdf_bytes:
            _pdf_b64 = base64.b64encode(pdf_bytes).decode()
            st.markdown(
                f'<iframe src="data:application/pdf;base64,{_pdf_b64}" width="100%" height="480" '
                f'style="border:1px solid #262B40;border-radius:12px;"></iframe>',
                unsafe_allow_html=True,
            )
            st.download_button(
                "⬇️ Descargar PDF original",
                data=pdf_bytes,
                file_name=f"{despacho_info['numero_despacho']}_{tipo_visor}.pdf",
                mime="application/pdf",
                key=f"descarga_{tipo_visor}",
            )

# --- Tab 2: propuesta de clasificacion + decision del liquidador -----------
with tab_clasificacion:
    decision = detalle.get("decision")

    if estado_actual == "REVISION_DOC":
        st.info(
            "Este despacho aun no fue procesado. Carga los documentos y presiona "
            "'⚙️ Procesar información' en la pestaña **① Revisión** para generar la propuesta de clasificacion."
        )

    elif estado_actual in ("REVISADO", "OBSERVADO"):
        # Despacho ya cerrado: la fuente de verdad es la decision persistida
        # (historial_clasificaciones), no la cache de clasificacion en
        # memoria del backend -- esa se limpia justo al decidir (ver
        # app.main.registrar_decision), por diseno, para evitar decisiones
        # duplicadas sobre la misma propuesta.
        if clasificacion is not None:
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
        elif decision is not None:
            _subpartida_html = html.escape(decision["subpartida_final_humano"])
            _accion_html = html.escape(decision["tipo_accion"])
            st.markdown(
                f"""
                <div class="classification-hero">
                    <span class="subpartida">{_subpartida_html}</span>
                    <span class="confidence-chip confidence-chip--{'ALTA' if _accion_html == 'APROBADO' else 'BAJA'}">{_accion_html}</span>
                    <div class="sustento">Subpartida final decidida por el liquidador.</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            st.info("No hay informacion de clasificacion disponible para este despacho.")

        if estado_actual == "REVISADO":
            st.success("✅ Este despacho fue **REVISADO**: el liquidador acepto la propuesta.")
        else:
            _motivo = decision.get("motivo_modificacion") if decision else None
            st.warning(
                "⚠️ Este despacho fue **OBSERVADO** por el liquidador."
                + (f" Motivo: {_motivo}" if _motivo else "")
            )

    elif clasificacion is None:
        # Estado CLASIFICACION pero la cache en memoria del backend se
        # perdio (p.ej. tras un reinicio del proceso) -- limitacion
        # conocida del MVP (ver app/main.py, _cache_clasificaciones).
        st.warning(
            "No se encontro la propuesta de clasificacion en memoria (puede pasar si el backend se "
            "reinicio). Vuelve a enviar el despacho a clasificacion."
        )
        if PUEDE_ENVIAR_A_CLASIFICACION and st.button("🔁 Reintentar clasificacion", type="primary"):
            with st.spinner("Generando la propuesta de clasificacion..."):
                resultado = api_post(f"/despachos/{id_despacho}/enviar-a-clasificacion")
            if resultado:
                st.rerun()

    else:
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

        if not PUEDE_DECIDIR_CLASIFICACION:
            st.caption("Solo un liquidador puede aceptar u observar esta clasificacion.")
        else:
            st.markdown("##### Decisión del liquidador")
            factura_doc = documentos_por_tipo.get("FACTURA")
            accion_label = st.radio(
                "¿La propuesta es correcta?",
                ["Revisión conforme", "Observar"],
                key="accion_decision",
                horizontal=True,
            )
            subpartida_final = clasificacion["subpartida_sugerida"]
            motivo = None
            if accion_label == "Observar":
                subpartida_final = st.text_input(
                    "Subpartida corregida", value=clasificacion["subpartida_sugerida"], key="subpartida_corregida"
                )
                motivo = st.text_area("Motivo de la observación (obligatorio)", key="motivo_observacion")

            if st.button("Confirmar decisión", type="primary"):
                if accion_label == "Observar" and not (motivo and motivo.strip()):
                    st.error("Debes indicar el motivo de la observación.")
                else:
                    descripcion_comercial = (
                        factura_doc["contenido_json"].get("descripcion_mercancia", "") if factura_doc else ""
                    )
                    atributos = {
                        "incoterm": factura_doc["contenido_json"].get("incoterm") if factura_doc else None,
                    }
                    cuerpo_decision = {
                        "accion": "REVISADO" if accion_label == "Revisión conforme" else "OBSERVADO",
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

# --- Tab 3: borrador de correo ----------------------------------------------
with tab_correo:
    if not borrador:
        st.info("Aun no se ha generado un borrador de correo (se genera al enviar a clasificacion).")
    else:
        st.markdown(
            f'<div class="letter-header">✉️ {html.escape(borrador["asunto"])}</div>',
            unsafe_allow_html=True,
        )
        cuerpo_actual = borrador.get("cuerpo_editado") or borrador["cuerpo"]
        nuevo_cuerpo = st.text_area(
            "Cuerpo (editable)", value=cuerpo_actual, height=320, key="cuerpo_borrador", label_visibility="collapsed"
        )
        st.caption("Este correo no se envia automaticamente: copialo y envialo desde tu cliente de correo habitual.")
        if st.button("💾 Guardar edición del borrador"):
            actualizado = api_patch(f"/borradores/{borrador['id']}", {"cuerpo_editado": nuevo_cuerpo})
            if actualizado:
                st.success("Borrador actualizado.")
                st.rerun()
