import type {
  DocumentoExtraidoOut,
  EstadoDespacho,
  HistorialClasificacionOut,
  PropuestaClasificacionOut,
} from "@/lib/types";

export interface ClasificacionTabProps {
  idDespacho: string;
  estadoDespacho: EstadoDespacho;
  documentos: DocumentoExtraidoOut[];
  /** Cache en memoria del backend -- puede venir null (recien enviado a
   * clasificacion y backend reiniciado, o despacho ya cerrado). */
  clasificacion: PropuestaClasificacionOut | null;
  /** Decision ya persistida -- fuente de verdad para despachos cerrados
   * (REVISADO/OBSERVADO), fallback cuando `clasificacion` es null. */
  decision: HistorialClasificacionOut | null;
}

// TODO(agente tab-clasificacion-correo): 3 ramas por estado (REVISION_DOC
// -> apunta al tab 1; REVISADO/OBSERVADO -> hero simplificado con
// clasificacion ?? decision; CLASIFICACION -> hero completo +
// MissingInfoAlert + DecisionForm gateado a LIQUIDADOR). Ver
// frontend/dashboard.py (tab_clasificacion) para el comportamiento de
// referencia. Placeholder temporal.
export function ClasificacionTab(props: ClasificacionTabProps) {
  return <pre className="text-xs text-texto-secundario">{JSON.stringify(props, null, 2)}</pre>;
}
