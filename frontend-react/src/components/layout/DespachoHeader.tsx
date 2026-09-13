import type { ReactNode } from "react";

import { ESTADO_INFO } from "@/lib/estado";
import type { DespachoOut } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

/** Encabezado del despacho activo: numero (mono) + badge de estado
 * (color diferenciado por estado) + cliente. React escapa el texto por
 * defecto, asi que a diferencia de la version Streamlit no hace falta
 * un html.escape manual aqui. `children` (opcional) se alinea a la
 * derecha -- lo usa `DespachoPage` para los botones de exportar, sin que
 * este componente necesite saber que existen. */
export function DespachoHeader({ despacho, children }: { despacho: DespachoOut; children?: ReactNode }) {
  const info = ESTADO_INFO[despacho.estado];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-lg font-semibold text-texto">{despacho.numero_despacho}</span>
        <Badge variant={info.variant}>{info.label}</Badge>
        <span className="text-sm text-texto-secundario">{despacho.cliente}</span>
      </div>
      {children}
    </div>
  );
}
