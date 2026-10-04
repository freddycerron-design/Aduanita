import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ResultadoValidacionOut, Severidad } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";

/** Exportado para reusar el mismo mapeo de color/icono/etiqueta en los
 * chips de filtro y el resumen de hallazgos (ver RevisionTab). `etiqueta`
 * es lo que ve el usuario: el enum (`ALTA`/`MEDIA`/`NINGUNA`) es un
 * identificador interno del motor de validacion y "NINGUNA" en particular
 * se lee como "no hay nada" en vez de "todo cuadra". */
export const SEVERIDAD_INFO: Record<
  Severidad,
  {
    etiqueta: string;
    variant: NonNullable<BadgeProps["variant"]>;
    borde: string;
    color: string;
    Icono: LucideIcon;
  }
> = {
  ALTA: { etiqueta: "Crítico", variant: "rojo", borde: "border-l-rojo", color: "text-rojo", Icono: AlertCircle },
  MEDIA: { etiqueta: "A revisar", variant: "amber", borde: "border-l-amber", color: "text-amber", Icono: AlertTriangle },
  NINGUNA: { etiqueta: "Conforme", variant: "verde", borde: "border-l-verde", color: "text-verde", Icono: CheckCircle2 },
};

/**
 * Una fila de discrepancia semaforizada por severidad (equivalente al
 * `.ledger-row`/`.ledger-chip` de la version Streamlit, reconstruido con
 * Tailwind + los primitivos Badge). `detalle` ya viene redactado por el
 * backend y es el texto principal. `regla` es un identificador interno
 * fijo (services/validation_engine.py, p.ej. MONTO_FACTURA_VS_SWIFT) que
 * no le dice nada al especialista, asi que solo queda en el tooltip del
 * icono para depuracion.
 */
export function LedgerRow({ resultado }: { resultado: ResultadoValidacionOut }) {
  const info = SEVERIDAD_INFO[resultado.severidad];
  const Icono = info.Icono;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-border border-l-4 bg-surface px-3 py-2",
        info.borde,
      )}
    >
      <span title={resultado.regla} className="mt-0.5 shrink-0">
        <Icono className={cn("size-4", info.color)} aria-hidden="true" />
      </span>
      <div className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
        <Badge variant={info.variant} className="shrink-0">
          {info.etiqueta}
        </Badge>
        <p className="text-[15px] leading-snug text-texto">{resultado.detalle}</p>
      </div>
    </div>
  );
}
