import type { EstadoDespacho } from "@/lib/types";
import type { BadgeProps } from "@/components/ui/badge";

/** Label + color de badge consistentes para un estado de despacho --
 * usado en el Explorer (agrupado), el header del despacho y donde mas
 * haga falta mostrar el estado. */
export const ESTADO_INFO: Record<EstadoDespacho, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  REVISION_DOC: { label: "Revisión Doc.", variant: "indigo" },
  CLASIFICACION: { label: "Clasificación", variant: "amber" },
  REVISADO: { label: "Revisados", variant: "verde" },
  OBSERVADO: { label: "Observados", variant: "rojo" },
};

/** Orden de los grupos del Explorer -- mismo orden que la version Streamlit. */
export const ORDEN_ESTADOS: EstadoDespacho[] = ["REVISION_DOC", "CLASIFICACION", "REVISADO", "OBSERVADO"];
