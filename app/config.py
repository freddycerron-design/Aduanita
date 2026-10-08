"""
Configuracion centralizada del backend.

Carga las variables de entorno (.env) y expone factories para los
clientes compartidos hacia Supabase y Gemini. Es el unico lugar del
proyecto que sabe leer el .env; tanto app/main.py como services/*.py
importan desde aqui.
"""
import logging
from functools import lru_cache

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic_settings import BaseSettings, SettingsConfigDict
from supabase import Client, create_client


class Settings(BaseSettings):
    """Variables de entorno requeridas por el backend (ver .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_storage_bucket: str = "documentos-aduaneros"
    gemini_api_key: str
    # Uno o mas origenes separados por coma (el frontend Streamlit y, desde
    # la migracion a React, tambien el nuevo sitio -- conviven mientras se
    # verifica el reemplazo, ver render.yaml). Un solo origen sin coma sigue
    # funcionando igual que antes.
    cors_origin: str = "http://localhost:8501,http://localhost:5173"

    # Modelos de Gemini. Van en variables de entorno (y no fijos en el
    # codigo) porque Google ya retiro dos veces el modelo que usaba el
    # proyecto: asi se cambia desde el panel de Render sin desplegar, y en
    # el .env local se puede usar otro modelo para pruebas (la cuota del
    # plan gratuito es por modelo, no se gasta la de produccion).
    gemini_model_texto_y_vision: str = "gemini-3.6-flash"
    # Respaldo, en orden, si el principal falla por no existir (404), por
    # cuota agotada (429) o por saturacion/caida (5xx). Separados por coma;
    # vacio = sin respaldo.
    gemini_models_respaldo: str = "gemini-3.5-flash,gemini-3.7-flash"
    # SIN respaldo a proposito: otro modelo de embeddings genera vectores
    # incompatibles con los ya guardados en historial_clasificaciones.
    gemini_model_embeddings: str = "gemini-embedding-001"

    @property
    def cors_origins(self) -> list[str]:
        return [origen.strip() for origen in self.cors_origin.split(",") if origen.strip()]

    @property
    def gemini_modelos_texto(self) -> list[str]:
        """Principal + respaldos, sin repetidos y en orden."""
        respaldos = [m.strip() for m in self.gemini_models_respaldo.split(",") if m.strip()]
        return list(dict.fromkeys([self.gemini_model_texto_y_vision, *respaldos]))


@lru_cache
def get_settings() -> Settings:
    """Instancia unica (cacheada) de Settings. Lanza un error claro en el
    arranque del proceso si falta alguna variable obligatoria en .env."""
    return Settings()


@lru_cache
def get_supabase_admin_client() -> Client:
    """Cliente Supabase con la clave service_role.

    Bypassa Row Level Security por completo: solo debe usarse desde el
    backend para las operaciones automatizadas del pipeline (subir
    documentos, guardar resultados de validacion, etc). Nunca exponer
    esta clave ni este cliente al frontend.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_user_client(access_token: str) -> Client:
    """Cliente Supabase que actua en nombre del especialista autenticado.

    Usa la clave anon + el JWT de sesion del usuario, de modo que las
    politicas RLS y `auth.uid()` se evaluen como el usuario real (necesario
    para registrar correctamente quien aprueba/corrige una clasificacion
    o edita un borrador de correo). Se crea una instancia nueva por
    request porque el token cambia por usuario.
    """
    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(access_token)
    return client


@lru_cache
def get_genai_client() -> genai.Client:
    """Cliente de Gemini (google-genai), reutilizado en todo el proceso."""
    settings = get_settings()
    return genai.Client(api_key=settings.gemini_api_key)


# Historial de los modelos de Gemini (la configuracion actual vive en
# Settings, ver arriba): "gemini-1.5-flash" y "text-embedding-004" (los
# originales) fueron retirados por Google, y "gemini-2.5-flash" -- pese a
# listarse en /v1beta/models -- devuelve 404 "no longer available to new
# users". En octubre 2026 se verifico contra la API real que
# gemini-3.6-flash, gemini-3.7-flash y gemini-3.5-flash responden JSON
# estructurado.

# gemini-embedding-001 emite 3072 dims por defecto; se trunca a 768 (via
# output_dimensionality) para calzar exacto con la columna vector(768) del
# schema. Ver services/rag_service.generar_embedding.
EMBEDDING_DIMENSIONS = 768

# Errores en los que tiene sentido probar con otro modelo: el modelo no
# existe para esta cuenta (404), se agoto su cuota (429) o esta saturado
# o caido (5xx). Un 400 (pedido mal armado) fallaria igual con cualquiera.
_CODIGOS_PARA_RESPALDO = {404, 429, 500, 502, 503, 504}

_logger = logging.getLogger(__name__)


def generar_contenido_gemini(
    contenidos: list, configuracion: genai_types.GenerateContentConfig
) -> genai_types.GenerateContentResponse:
    """`generate_content` con el modelo principal y, si falla por un error
    del lado del modelo (ver _CODIGOS_PARA_RESPALDO), con los de respaldo
    en orden. Si fallan todos, propaga el error del ultimo."""
    cliente = get_genai_client()
    modelos = get_settings().gemini_modelos_texto
    for indice, modelo in enumerate(modelos):
        try:
            respuesta = cliente.models.generate_content(model=modelo, contents=contenidos, config=configuracion)
        except genai_errors.APIError as error:
            if error.code not in _CODIGOS_PARA_RESPALDO or indice == len(modelos) - 1:
                raise
            _logger.warning("Gemini %s fallo (%s); se reintenta con %s", modelo, error.code, modelos[indice + 1])
            continue
        if indice > 0:
            _logger.warning("Respuesta generada con el modelo de respaldo %s", modelo)
        return respuesta
    raise RuntimeError("No hay modelos de Gemini configurados.")  # lista vacia: no deberia pasar
