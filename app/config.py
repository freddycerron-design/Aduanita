"""
Configuracion centralizada del backend.

Carga las variables de entorno (.env) y expone factories para los
clientes compartidos hacia Supabase y Gemini. Es el unico lugar del
proyecto que sabe leer el .env; tanto app/main.py como services/*.py
importan desde aqui.
"""
from functools import lru_cache

from google import genai
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
    cors_origin: str = "http://localhost:8501"


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


# Nombre de los modelos de Gemini usados en todo el proyecto. Centralizados
# aqui para poder actualizarlos en un solo lugar.
#
# NOTA: "gemini-1.5-flash" y "text-embedding-004" (elegidos originalmente)
# fueron retirados por Google. Incluso "gemini-2.5-flash" -- pese a listarse
# en /v1beta/models -- devuelve 404 "no longer available to new users".
# Se verifico contra la API real (agosto 2026) que "gemini-3.6-flash" si
# funciona (texto, JSON estructurado y vision) para este proyecto.
GEMINI_MODEL_TEXTO_Y_VISION = "gemini-3.6-flash"
GEMINI_MODEL_EMBEDDINGS = "gemini-embedding-001"
# gemini-embedding-001 emite 3072 dims por defecto; se trunca a 768 (via
# output_dimensionality) para calzar exacto con la columna vector(768) del
# schema. Ver services/rag_service.generar_embedding.
EMBEDDING_DIMENSIONS = 768
