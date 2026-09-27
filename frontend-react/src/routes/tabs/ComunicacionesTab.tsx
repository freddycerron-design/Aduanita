import { EmailDraftEditor } from "@/components/email/EmailDraftEditor";
import type { BorradorCorreoOut } from "@/lib/types";

export interface ComunicacionesTabProps {
  borrador: BorradorCorreoOut | null;
}

/**
 * Pestaña 5 (antes "Correo"): borrador generado al enviar el despacho a
 * clasificación, con el canal por el que el especialista piensa
 * enviarlo (correo, WhatsApp, o ambos -- ver `EmailDraftEditor`). Sigue
 * siendo solo un borrador: nada se envía automáticamente por ningún
 * canal, el especialista lo copia a mano.
 */
export function ComunicacionesTab({ borrador }: ComunicacionesTabProps) {
  if (!borrador) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-texto-secundario">
        Aún no se ha generado un borrador de comunicación (se genera al enviar a clasificación).
      </div>
    );
  }

  // key={borrador.id}: la ruta "despachos/:id" no remonta DespachoPage al
  // cambiar de despacho (no usa key={id} en el <Route>), asi que sin esto
  // el estado local del textarea de EmailDraftEditor quedaria pisado con
  // el borrador del despacho anterior al navegar entre despachos.
  return <EmailDraftEditor key={borrador.id} borrador={borrador} />;
}
