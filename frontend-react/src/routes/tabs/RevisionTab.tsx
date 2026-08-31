import type { DocumentoExtraidoOut, EstadoDespacho, ResultadoValidacionOut } from "@/lib/types";

export interface RevisionTabProps {
  idDespacho: string;
  estadoDespacho: EstadoDespacho;
  documentos: DocumentoExtraidoOut[];
  validaciones: ResultadoValidacionOut[];
  /** Llamar tras un "Procesar información" exitoso (POST
   * enviar-a-clasificacion) -- el padre invalida la query de detalle y
   * cambia automaticamente a la pestana de Clasificacion. */
  onProcesado: () => void;
}

// TODO(agente tab-revision): grid de 4 DocumentUploadCard (subir/eliminar
// por tipo), boton "Procesar información" (gateado por rol + minimo
// Factura+BL), lista de discrepancias (LedgerRow) y visor JSON/PDF
// (DocumentViewer). Ver frontend/dashboard.py (tab_revision) para el
// comportamiento de referencia. Placeholder temporal.
export function RevisionTab(props: RevisionTabProps) {
  return <pre className="text-xs text-texto-secundario">{JSON.stringify(props, null, 2)}</pre>;
}
