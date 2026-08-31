import type { BorradorCorreoOut } from "@/lib/types";

export interface CorreoTabProps {
  borrador: BorradorCorreoOut | null;
}

// TODO(agente tab-clasificacion-correo): encabezado tipo carta + Textarea
// editable (cuerpo_editado ?? cuerpo) + guardar via PATCH /borradores/{id}
// (useEditarBorrador). Ver frontend/dashboard.py (tab_correo) para el
// comportamiento de referencia. Placeholder temporal.
export function CorreoTab(props: CorreoTabProps) {
  return <pre className="text-xs text-texto-secundario">{JSON.stringify(props, null, 2)}</pre>;
}
