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

/** Los 3 primeros son el equipo interno; CLIENTE es una cuenta EXTERNA
 * de solo lectura (portal del importador), no un 4to rol del equipo. */
export type Rol = "GESTOR" | "LIQUIDADOR" | "ADMIN" | "CLIENTE";

export type Severidad = "ALTA" | "MEDIA" | "NINGUNA";

export type NivelConfianza = "ALTA" | "MEDIA" | "BAJA";

// --- despachos --------------------------------------------------------

export interface DespachoOut {
  id: string;
  numero_despacho: string;
  cliente: string;
  /** Libre, opcional -- lo escribe el gestor al crear el despacho. */
  descripcion: string | null;
  estado: EstadoDespacho;
  fecha_creacion: string;
  /** Cliente registrado dueño del despacho; null si solo se cargó el
   * nombre en texto libre (entonces no aparece en ningún portal). */
  id_cliente: string | null;
  /** Nombre de quien creó el despacho. Solo lo trae el listado paginado
   * (ver `listarDespachos`) -- el resto de endpoints traen un solo
   * despacho y no vale la pena el join. */
  gestor: string | null;
}

export interface DespachoCreate {
  numero_despacho: string;
  cliente: string;
  descripcion?: string | null;
  id_cliente?: string | null;
  /** Gestor asignado a trabajar el despacho. Opcional a nivel API (si no
   * llega, el backend lo asigna a quien crea) pero el formulario lo
   * exige siempre. */
  id_gestor?: string | null;
}

/** Respuesta de GET /despachos: una página + el total de filas que hay en
 * total (respetando la búsqueda), para dibujar los controles de
 * paginación del Explorador sin traer todos los despachos de una. */
export interface DespachoListadoOut {
  items: DespachoOut[];
  total: number;
}

/** Una entrada del filtro "estilo Excel" de la columna Gestor. */
export interface GestorDistintoOut {
  id: string;
  nombre_completo: string;
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
  /** 0-1: que tan segura fue la lectura del modelo, segun el modelo mismo. */
  confianza_extraccion: number | null;
  /** Derivado de `confianza_extraccion` en el backend, para que los
   * umbrales vivan en un solo lugar (services/pdf_processor.py). */
  nivel_confianza: NivelConfianza | null;
  /** Campos que el modelo dijo no haber leido con seguridad. Se vacia
   * cuando una persona ya corrigio el documento a mano. */
  campos_inciertos: string[];
  /** Columnas de cada campo de tipo lista (ej. `items`), sacadas del
   * schema del backend: sin esto el formulario de correccion no podria
   * agregar la primera fila a una lista que llego vacia. */
  columnas_por_lista: Record<string, string[]>;
  /** Cuando se corrigio a mano por ultima vez; null si el contenido es
   * tal cual lo extrajo el modelo. */
  editado_en: string | null;
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

// --- borrador de comunicación ---------------------------------------------------------

/** Registro de intención, nada más: no hay integración de correo ni de
 * WhatsApp que de verdad envíe algo -- sigue siendo un borrador que el
 * especialista copia a mano. */
export type CanalEnvio = "CORREO" | "WHATSAPP" | "AMBOS";

export interface BorradorCorreoOut {
  id: string;
  tipo: string;
  asunto: string;
  cuerpo: string;
  cuerpo_editado: string | null;
  canal_envio: CanalEnvio;
}

/** Al menos uno de los dos debe venir -- editar el texto y elegir el
 * canal son dos acciones independientes en la UI (ver
 * ComunicacionesTab), y el backend solo actualiza los campos presentes. */
export interface ActualizarBorradorRequest {
  cuerpo_editado?: string;
  canal_envio?: CanalEnvio;
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

/** Un campo comparable de un tipo de documento: nombre tecnico (lo que se
 * guarda en la regla) + nombre legible (lo que ve el usuario). */
export interface CampoDocumento {
  campo: string;
  etiqueta: string;
}

export type CamposPorDocumento = Record<TipoDocumento, CampoDocumento[]>;

export interface CampoEstructura {
  campo: string;
  etiqueta: string;
  tipo_dato: "Texto" | "Número" | "Entero" | "Fecha";
  /** true = la extraccion siempre lo devuelve; false = puede venir vacio. */
  obligatorio: boolean;
  descripcion: string | null;
}

export interface EstructuraDocumento {
  cabecera: CampoEstructura[];
  detalle: { campo: string; etiqueta: string; columnas: CampoEstructura[] }[];
}

export type EstructuraPorDocumento = Record<TipoDocumento, EstructuraDocumento>;

// --- métricas de inicio ---------------------------------------------

export interface MetricasOut {
  en_revision: number;
  en_clasificacion: number;
  finalizados: number;
  hallazgos_altos_abiertos: number;
}

// --- arancel nacional ---------------------------------------------

/** Gravamenes vigentes de una subpartida, leidos en vivo del portal de SUNAT. */
export interface MedidasSunat {
  subpartida: string;
  tipo_producto: string | null;
  gravamenes: { concepto: string; valor: string }[];
  url_consulta: string;
}

export interface SubpartidaArancelaria {
  codigo: string;
  descripcion: string;
  ad_valorem: number | null;
  /** Relevancia del full-text search; 0 cuando la búsqueda fue por código. */
  rank: number;
}

// --- usuarios y roles (admin) ---------------------------------------

export interface UsuarioOut {
  id: string;
  email: string | null;
  nombre_completo: string;
  rol: Rol;
  activo: boolean;
  creado_en: string;
  /** Solo para cuentas con rol CLIENTE: a qué importador pertenecen. */
  id_cliente: string | null;
}

export interface UsuarioCreate {
  email: string;
  password: string;
  nombre_completo: string;
  rol: Rol;
  id_cliente?: string | null;
}

export interface UsuarioUpdate {
  nombre_completo: string;
  rol: Rol;
  activo: boolean;
  id_cliente?: string | null;
  /** Si se omite (undefined/vacío), no se toca la contraseña actual. */
  password?: string | null;
}

// --- clientes y portal del importador ---------------------------------

export type TipoPersona = "NATURAL" | "JURIDICA";
export type TipoDocumentoIdentidad = "DNI" | "RUC";

/** Datos del mantenimiento de Importadores ("Cliente" se renombró a
 * "Importador" en toda la interfaz; el nombre interno del tipo/tabla
 * sigue siendo "cliente"). */
export interface ClienteUpsert {
  razon_social: string;
  codigo?: string | null;
  tipo_persona: TipoPersona;
  tipo_documento: TipoDocumentoIdentidad;
  numero_documento: string;
  direccion_calle?: string | null;
  distrito?: string | null;
  departamento?: string | null;
  pais?: string | null;
  nombre_contacto?: string | null;
  telefono_contacto?: string | null;
  email_contacto?: string | null;
  activo: boolean;
}

export interface ClienteOut extends ClienteUpsert {
  id: string;
  creado_en: string;
  actualizado_en: string;
}

/** Lo ÚNICO que el portal expone de un despacho. Si un campo no está acá,
 * el backend no lo devuelve (ver PortalDespachoOut en app/main.py). */
export interface PortalDespachoOut {
  id: string;
  numero_despacho: string;
  estado: EstadoDespacho;
  fecha_creacion: string;
  actualizado_en: string | null;
}
