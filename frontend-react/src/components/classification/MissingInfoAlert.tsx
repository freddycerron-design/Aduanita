import { AlertTriangle } from "lucide-react";

export interface MissingInfoAlertProps {
  items: string[];
}

/** Aviso listando la informacion que el clasificador senalo como
 * necesaria para poder elevar el nivel de confianza de la propuesta
 * (`PropuestaClasificacionOut.informacion_faltante_alert`). */
export function MissingInfoAlert({ items }: MissingInfoAlertProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex gap-3 rounded-xl border border-amber/40 bg-amber/10 p-4">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" strokeWidth={1.75} aria-hidden="true" />
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-amber">Información faltante para elevar la confianza</p>
        <ul className="list-disc space-y-1 pl-4 text-sm text-texto-secundario marker:text-amber">
          {items.map((item, indice) => (
            <li key={`${indice}-${item}`}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
