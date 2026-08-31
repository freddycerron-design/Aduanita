/**
 * Espejo TypeScript de los modelos Pydantic de `app/main.py` (y de los
 * servicios que este importa: `services/validation_engine.py`,
 * `services/gemini_classifier.py`, `services/pdf_processor.py`).
 *
 * Mantener esto sincronizado con el backend a mano -- no hay generacion
 * automatica de tipos en este proyecto. Si cambia un modelo en el
 * backend, actualizar aqui.
 */

export type TipoDocumento = "FACTURA" | "SEGURO" | "SWIFT_BANCARIO" | "BL";

export const TIPOS_DOCUMENTO: TipoDocumento[] = ["FACTURA", "SEGURO", "SWIFT_BANCARIO", "BL"];

export type EstadoDespacho = "REVISION_DOC" | "CLASIFICACION" | "REVISADO" | "OBSERVADO";

export type Rol = "ESPECIALISTA" | "LIQUIDADOR" | "ADMIN";

export type Severidad = "ALTA" | "MEDIA" | "NINGUNA";

export type NivelConfianza = "ALTA" | "MEDIA" | "BAJA";

// --- despachos --------------------------------------------------------

export interface DespachoOut {
  id: string;
  numero_despacho: string;
  cliente: string;
  estado: EstadoDespacho;
  fecha_creacion: string;
}

export interface DespachoCreate {
  numero_despacho: string;
  cliente: string;
}

// --- documentos ---------------------------------------------------------

/** Subconjunto conocido de `contenido_json` para la FACTURA -- el resto de
 * los campos extraidos por Gemini se preservan pero no se tipan uno a uno
 * (ver `services/pdf_processor.py::FacturaSchema` para el detalle completo). */
export interface FacturaContenido {
  descripcion_mercancia?: string;
  incoterm?: string;
  peso_bruto_kg?: number;
  cantidad_bultos?: number;
  monto_total?: number;
  items?: Array<{
    descripcion: string;
    cantidad: number;
    unidad_medida?: string | null;
    material_declarado?: string | null;
  }>;
  [key: string]: unknown;
}

export interface DocumentoExtraidoOut {
  id: string;
  tipo_documento: TipoDocumento;
  contenido_json: Record<string, unknown>;
  url_pdf_storage: string;
  metodo_extraccion: string | null;
  procesado: boolean;
  confianza_extraccion: number | null;
}

// --- validaciones ---------------------------------------------------------

export interface ResultadoValidacionOut {
  regla: string;
  severidad: Severidad;
  detalle: string;
  valor_a: Record<string, unknown> | null;
  valor_b: Record<string, unknown> | null;
}

// --- clasificacion ---------------------------------------------------------

export interface PropuestaClasificacionOut {
  subpartida_sugerida: string;
  nivel_confianza: NivelConfianza;
  informacion_faltante_alert: string[];
  sustento_legal_rgi: string;
}

// --- borrador de correo ---------------------------------------------------------

export interface BorradorCorreoOut {
  id: string;
  tipo: string;
  asunto: string;
  cuerpo: string;
  cuerpo_editado: string | null;
}

export interface ActualizarBorradorRequest {
  cuerpo_editado: string;
}

// --- decision del liquidador ---------------------------------------------------------

export interface DecisionRequest {
  accion: "REVISADO" | "OBSERVADO";
  subpartida_sugerida_ia: string;
  subpartida_final: string;
  descripcion_comercial: string;
  atributos: Record<string, unknown>;
  motivo_modificacion?: string | null;
}

export interface HistorialClasificacionOut {
  id: string;
  id_despacho: string | null;
  subpartida_sugerida_ia: string;
  subpartida_final_humano: string;
  tipo_accion: "APROBADO" | "EDITADO";
  motivo_modificacion: string | null;
  peso_prioridad: number;
  aprobado_por: string;
}

// --- detalle compuesto ---------------------------------------------------------

export interface DespachoDetalleOut {
  despacho: DespachoOut;
  documentos: DocumentoExtraidoOut[];
  validaciones: ResultadoValidacionOut[];
  /** Cache en memoria del backend -- se limpia justo al registrar una
   * decision (ver `registrar_decision` en app/main.py). Para un despacho
   * ya cerrado (REVISADO/OBSERVADO) esto normalmente viene null y hay que
   * usar `decision` como fuente de verdad en su lugar. */
  clasificacion: PropuestaClasificacionOut | null;
  borrador: BorradorCorreoOut | null;
  /** Decision ya persistida (historial_clasificaciones), fuente de verdad
   * para despachos cerrados. */
  decision: HistorialClasificacionOut | null;
}

export interface PipelineResultOut {
  validaciones: ResultadoValidacionOut[];
  clasificacion: PropuestaClasificacionOut;
  borrador: BorradorCorreoOut;
  estado_final: string;
}

// --- perfil del usuario autenticado (tabla perfiles_especialista) -----------

export interface PerfilEspecialista {
  id: string;
  nombre_completo: string | null;
  rol: Rol;
  activo: boolean;
}
