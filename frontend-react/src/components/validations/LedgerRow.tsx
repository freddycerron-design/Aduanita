import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ResultadoValidacionOut, Severidad } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";

/** Exportado para reusar el mismo mapeo de color/icono en los chips de
 * filtro por severidad (ver RevisionTab). */
export const SEVERIDAD_INFO: Record<
  Severidad,
  { variant: NonNullable<BadgeProps["variant"]>; borde: string; color: string; Icono: LucideIcon }
> = {
  ALTA: { variant: "rojo", borde: "border-l-rojo", color: "text-rojo", Icono: AlertCircle },
  MEDIA: { variant: "amber", borde: "border-l-amber", color: "text-amber", Icono: AlertTriangle },
  NINGUNA: { variant: "verde", borde: "border-l-verde", color: "text-verde", Icono: CheckCircle2 },
};

/**
 * Una fila de discrepancia semaforizada por severidad (equivalente al
 * `.ledger-row`/`.ledger-chip` de la version Streamlit, reconstruido con
 * Tailwind + los primitivos Badge). `regla` es un identificador interno
 * fijo (services/validation_engine.py) y no se traduce; `detalle` ya viene
 * redactado por el backend y se muestra tal cual.
 */
export function LedgerRow({ resultado }: { resultado: ResultadoValidacionOut }) {
  const info = SEVERIDAD_INFO[resultado.severidad];
  const Icono = info.Icono;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-border border-l-4 bg-surface px-3 py-1.5",
        info.borde,
      )}
    >
      <Icono className={cn("mt-0.5 size-4 shrink-0", info.color)} />
      <div className="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
        <Badge variant={info.variant}>{resultado.severidad}</Badge>
        <p className="text-sm leading-snug text-texto">
          <span className={cn("font-mono font-semibold", info.color)}>{resultado.regla}</span>
          {" — "}
          {resultado.detalle}
        </p>
      </div>
    </div>
  );
}
