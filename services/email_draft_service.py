"""
Generador de borradores de correo con los resultados del pipeline
(validacion + clasificacion), o con la solicitud de informacion faltante
cuando los datos tecnicos no alcanzan para clasificar con confianza.

Decision de diseno: el cuerpo del correo se arma con plantillas
deterministas (f-strings), NO con un LLM. Esto evita que un modelo
generativo "alucine" cifras o discrepancias que no existen, y ahorra
cuota gratuita de Gemini para las tareas donde si aporta valor
(extraccion y clasificacion). El correo es siempre un BORRADOR: el
sistema no lo envia, el especialista lo copia o edita desde el
dashboard.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from supabase import Client

from services.gemini_classifier import PropuestaClasificacion
from services.validation_engine import ResultadoValidacion

TipoBorrador = Literal["RESULTADOS", "SOLICITUD_INFO_FALTANTE"]


class DespachoInfo(BaseModel):
    numero_despacho: str
    cliente: str


class BorradorCorreo(BaseModel):
    tipo: TipoBorrador
    asunto: str
    cuerpo: str


_DISCLAIMER = (
    "\n\nNota: la subpartida indicada es una propuesta generada con apoyo de inteligencia artificial "
    "y antecedentes de clasificaciones previas. Se encuentra sujeta a validacion y aprobacion final "
    "por parte de un especialista aduanero antes de su uso en la declaracion."
)


def _listar_discrepancias(validaciones: list[ResultadoValidacion], severidad: str) -> str:
    filtradas = [v for v in validaciones if v.severidad == severidad]
    if not filtradas:
        return "  (ninguna)"
    return "\n".join(f"  - [{v.regla}] {v.detalle}" for v in filtradas)


def _generar_borrador_solicitud_info_faltante(
    despacho: DespachoInfo,
    validaciones: list[ResultadoValidacion],
    clasificacion: PropuestaClasificacion | None,
) -> BorradorCorreo:
    asunto = f"Informacion adicional requerida - Despacho {despacho.numero_despacho}"

    faltantes = clasificacion.informacion_faltante_alert if clasificacion else []
    if not faltantes:
        faltantes = [
            "Descripcion tecnica detallada de la mercancia (material, composicion, uso o funcion)."
        ]

    lista_faltantes = "\n".join(f"  - {dato}" for dato in faltantes)
    discrepancias_altas = _listar_discrepancias(validaciones, "ALTA")

    cuerpo = (
        f"Estimado(a) {despacho.cliente},\n\n"
        f"Estamos procesando el despacho {despacho.numero_despacho} y, para poder completar la "
        f"clasificacion arancelaria con la confianza requerida, necesitamos que nos proporcione la "
        f"siguiente informacion adicional:\n\n"
        f"{lista_faltantes}\n\n"
        f"Adicionalmente, se identificaron las siguientes discrepancias entre los documentos que "
        f"requieren su confirmacion o correccion:\n{discrepancias_altas}\n\n"
        f"Quedamos atentos a su respuesta para continuar con el tramite.\n\n"
        f"Saludos cordiales."
        f"{_DISCLAIMER}"
    )

    return BorradorCorreo(tipo="SOLICITUD_INFO_FALTANTE", asunto=asunto, cuerpo=cuerpo)


def _generar_borrador_resultados(
    despacho: DespachoInfo,
    validaciones: list[ResultadoValidacion],
    clasificacion: PropuestaClasificacion,
) -> BorradorCorreo:
    asunto = f"Resultados de revision documental y clasificacion - Despacho {despacho.numero_despacho}"

    discrepancias_altas = _listar_discrepancias(validaciones, "ALTA")
    discrepancias_medias = _listar_discrepancias(validaciones, "MEDIA")
    hay_alertas = any(v.severidad == "ALTA" for v in validaciones)

    resumen_discrepancias = (
        f"Se identificaron discrepancias que requieren atencion:\n"
        f"  Severidad ALTA:\n{discrepancias_altas}\n"
        f"  Severidad MEDIA (no verificables o menores):\n{discrepancias_medias}\n"
        if hay_alertas
        else "No se identificaron discrepancias relevantes entre los documentos revisados.\n"
    )

    faltante = ""
    if clasificacion.informacion_faltante_alert:
        lista = "\n".join(f"  - {dato}" for dato in clasificacion.informacion_faltante_alert)
        faltante = f"\n\nPara elevar la confianza de la clasificacion, seria util contar ademas con:\n{lista}"

    cuerpo = (
        f"Estimado(a) {despacho.cliente},\n\n"
        f"Le compartimos los resultados de la revision documental del despacho {despacho.numero_despacho}:\n\n"
        f"{resumen_discrepancias}\n"
        f"Propuesta de clasificacion arancelaria:\n"
        f"  Subpartida nacional sugerida: {clasificacion.subpartida_sugerida}\n"
        f"  Nivel de confianza: {clasificacion.nivel_confianza}\n"
        f"  Sustento legal: {clasificacion.sustento_legal_rgi}"
        f"{faltante}\n\n"
        f"Quedamos atentos a cualquier comentario.\n\n"
        f"Saludos cordiales."
        f"{_DISCLAIMER}"
    )

    return BorradorCorreo(tipo="RESULTADOS", asunto=asunto, cuerpo=cuerpo)


def generar_borrador(
    despacho: DespachoInfo,
    validaciones: list[ResultadoValidacion],
    clasificacion: PropuestaClasificacion | None,
    info_suficiente: bool,
) -> BorradorCorreo:
    """Decide y genera el tipo de borrador correspondiente:

    - SOLICITUD_INFO_FALTANTE si la informacion tecnica no alcanza para
      clasificar (info_suficiente=False) o si la IA reporto datos
      faltantes (clasificacion.informacion_faltante_alert no vacio).
    - RESULTADOS en cualquier otro caso (incluye disclaimer y, si
      corresponde, discrepancias detectadas).
    """
    necesita_info = (not info_suficiente) or (clasificacion is not None and clasificacion.informacion_faltante_alert)

    if necesita_info:
        return _generar_borrador_solicitud_info_faltante(despacho, validaciones, clasificacion)

    assert clasificacion is not None  # invariante: si no necesita info, ya se pudo clasificar
    return _generar_borrador_resultados(despacho, validaciones, clasificacion)


def guardar_borrador(supabase: Client, id_despacho: str, borrador: BorradorCorreo) -> dict:
    fila = {
        "id_despacho": id_despacho,
        "tipo": borrador.tipo,
        "asunto": borrador.asunto,
        "cuerpo": borrador.cuerpo,
    }
    respuesta = supabase.table("borradores_correo").insert(fila).execute()
    return respuesta.data[0]


def actualizar_borrador_editado(supabase_usuario: Client, id_borrador: str, cuerpo_editado: str, editado_por: str) -> dict:
    """Guarda la version editada por el especialista. `supabase_usuario`
    debe ser un cliente autenticado con el JWT del usuario para que la
    politica RLS valide auth.uid() = editado_por."""
    respuesta = (
        supabase_usuario.table("borradores_correo")
        .update({"cuerpo_editado": cuerpo_editado, "editado_por": editado_por})
        .eq("id", id_borrador)
        .execute()
    )
    return respuesta.data[0]
