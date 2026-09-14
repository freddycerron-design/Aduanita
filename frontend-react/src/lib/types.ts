/**
 * Espejo TypeScript de los modelos Pydantic de `app/main.py` (y de los
 * servicios que este importa: `services/validation_engine.py`,
 * `services/gemini_classifier.py`, `services/pdf_processor.py`).
 *
 * Mantener esto sincronizado con el backend a mano -- no hay generacion
 * automatica de tipos en este proyecto. Si cambia un modelo en el
 * backend, actualizar aqui.
 */

export type TipoDocumento = "FACTURA" | "SEGURO" | "SWIFT_BANCARIO" | "BL" | "PACKING_LIST";

export const TIPOS_DOCUMENTO: TipoDocumento[] = ["FACTURA", "SEGURO", "SWIFT_BANCARIO", "BL", "PACKING_LIST"];

export type EstadoDespacho = "REVISION_DOC" | "CLASIFICACION" | "FINALIZADO";

export type Rol = "GESTOR" | "LIQUIDADOR" | "ADMIN";

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
  /** 0 (muy insegura) a 1 (muy segura) -- `nivel_confianza` se deriva de
   * este valor en el backend (services/gemini_classifier.py), nunca al
   * reves, asi que las dos senales de confianza nunca se contradicen. */
  score_confianza: number;
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

// --- pre-liquidacion de tributos ---------------------------------------------------------

export interface PreliquidacionOut {
  id: string;
  id_despacho: string;
  subpartida: string;
  valor_cif: number;
  moneda: string;
  ad_valorem_tasa: number;
  ad_valorem_monto: number;
  base_igv_ipm: number;
  igv_monto: number;
  ipm_monto: number;
  antidumping_monto: number;
  derecho_especifico_monto: number;
  total_tributos: number;
  actualizado_en: string;
}

export interface CalcularPreliquidacionRequest {
  valor_cif: number;
  moneda?: string;
  /** Si se omiten, el backend usa el default de cargos_especiales_arancel
   * para la subpartida vigente (o 0 si tampoco hay default cargado). */
  antidumping_monto?: number | null;
  derecho_especifico_monto?: number | null;
}

export interface PreliquidacionDetalleOut {
  preliquidacion: PreliquidacionOut | null;
  subpartida_vigente: string | null;
  cargo_especial_default: CargoEspecialArancelOut | null;
}

// --- cargos especiales del arancel (admin: antidumping / derecho especifico) --------

export interface CargoEspecialArancelUpsert {
  subpartida: string;
  antidumping_monto: number;
  derecho_especifico_monto: number;
  moneda: string;
  nota?: string | null;
}

export interface CargoEspecialArancelOut extends CargoEspecialArancelUpsert {
  id: string;
  creado_en: string;
  actualizado_en: string;
}

// --- detalle compuesto ---------------------------------------------------------

export interface DespachoDetalleOut {
  despacho: DespachoOut;
  documentos: DocumentoExtraidoOut[];
  validaciones: ResultadoValidacionOut[];
  /** Cache en memoria del backend -- se limpia justo al registrar una
   * decision (ver `registrar_decision` en app/main.py). Para un despacho
   * ya FINALIZADO esto normalmente viene null y hay que usar `decision`
   * como fuente de verdad en su lugar. */
  clasificacion: PropuestaClasificacionOut | null;
  borrador: BorradorCorreoOut | null;
  /** Decision ya persistida (historial_clasificaciones), fuente de verdad
   * para despachos FINALIZADOs. */
  decision: HistorialClasificacionOut | null;
  /** Snapshot ya calculado de la pre-liquidacion (null si aun no se
   * presiono "Calcular" en esa pestaña). */
  preliquidacion: PreliquidacionOut | null;
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

// --- reglas de validacion (admin, motor generico) ---------------------------

/** Los 3 tipos de comparacion que interpreta `services/validation_engine.py`
 * -- ver el comentario de la columna `tipo_comparacion` en
 * `database/schema.sql` (tabla `reglas_validacion`) para el detalle exacto
 * de la logica de cada uno. */
export type TipoComparacion = "RANGO_ASIMETRICO" | "IGUALDAD_EXACTA" | "TEXTO_FUZZY";

export interface ParametrosRangoAsimetrico {
  umbral_inferior: number;
  severidad_inferior: Severidad;
  umbral_superior: number;
  severidad_superior: Severidad;
}

export interface ParametrosIgualdadExacta {
  severidad_si_distinto: Severidad;
  normalizar_texto: boolean;
}

export interface ParametrosTextoFuzzy {
  umbral_similitud: number;
  severidad_si_distinto: Severidad;
}

export type ParametrosRegla = ParametrosRangoAsimetrico | ParametrosIgualdadExacta | ParametrosTextoFuzzy;

export interface ReglaValidacionUpsert {
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  activo: boolean;
  documento_a: TipoDocumento;
  campo_a: string;
  documento_b: TipoDocumento;
  campo_b: string;
  campo_moneda_a?: string | null;
  campo_moneda_b?: string | null;
  severidad_moneda_distinta?: Severidad | null;
  severidad_dato_faltante: Severidad;
  tipo_comparacion: TipoComparacion;
  /** Shape depende de `tipo_comparacion` -- el backend valida esto contra
   * el discriminated union correspondiente antes de persistir. */
  parametros: Record<string, unknown>;
}

export interface ReglaValidacionOut extends ReglaValidacionUpsert {
  id: string;
  creado_en: string;
  actualizado_en: string;
}

// --- usuarios y roles (admin) ---------------------------------------

export interface UsuarioOut {
  id: string;
  email: string | null;
  nombre_completo: string;
  rol: Rol;
  activo: boolean;
  creado_en: string;
}

export interface UsuarioCreate {
  email: string;
  password: string;
  nombre_completo: string;
  rol: Rol;
}

export interface UsuarioUpdate {
  nombre_completo: string;
  rol: Rol;
  activo: boolean;
  /** Si se omite (undefined/vacío), no se toca la contraseña actual. */
  password?: string | null;
}
