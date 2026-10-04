import type { ReactNode } from "react";

import type { DespachoDetalleOut } from "@/lib/types";
import { RutaDespacho } from "@/components/layout/RutaDespacho";

/** Encabezado del despacho activo: número (mono) + importador, debajo la
 * "Ruta del despacho" (tramo actual + próxima acción, ver
 * `RutaDespacho`), y al final la descripción libre si se escribió una al
 * crearlo (no todos los despachos la tienen -- por eso la fila entera se
 * omite cuando viene null).
 *
 * Recibe el detalle completo (no solo `DespachoOut`) porque la próxima
 * acción depende de los documentos cargados, la clasificación y la
 * decisión. Ya no muestra el badge de estado: la ruta lo comunica (tramo
 * resaltado) y con más contexto, y repetirlo era redundante.
 *
 * React escapa el texto por defecto, así que a diferencia de la versión
 * Streamlit no hace falta un html.escape manual aquí. `children`
 * (opcional) se alinea a la derecha de la primera fila -- lo usa
 * `DespachoPage` para los botones de exportar, sin que este componente
 * necesite saber que existen. */
export function DespachoHeader({ detalle, children }: { detalle: DespachoDetalleOut; children?: ReactNode }) {
  const { despacho } = detalle;

  return (
    <div className="flex flex-col gap-2.5 border-b border-border px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-mono text-lg font-semibold text-texto">{despacho.numero_despacho}</h1>
          <span className="text-sm text-texto-secundario">{despacho.cliente}</span>
        </div>
        {children}
      </div>
      <RutaDespacho detalle={detalle} />
      {despacho.descripcion && (
        <p className="truncate text-sm text-texto-secundario" title={despacho.descripcion}>
          {despacho.descripcion}
        </p>
      )}
    </div>
  );
}
