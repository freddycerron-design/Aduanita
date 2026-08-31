import { EmailDraftEditor } from "@/components/email/EmailDraftEditor";
import type { BorradorCorreoOut } from "@/lib/types";

export interface CorreoTabProps {
  borrador: BorradorCorreoOut | null;
}

/**
 * Pestaña 3: borrador de correo generado al enviar el despacho a
 * clasificación. Ver `tab_correo` en el dashboard.py viejo para el
 * comportamiento de referencia.
 */
export function CorreoTab({ borrador }: CorreoTabProps) {
  if (!borrador) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-texto-secundario">
        Aún no se ha generado un borrador de correo (se genera al enviar a clasificación).
      </div>
    );
  }

  // key={borrador.id}: la ruta "despachos/:id" no remonta DespachoPage al
  // cambiar de despacho (no usa key={id} en el <Route>), asi que sin esto
  // el estado local del textarea de EmailDraftEditor quedaria pisado con
  // el borrador del despacho anterior al navegar entre despachos.
  return <EmailDraftEditor key={borrador.id} borrador={borrador} />;
}
