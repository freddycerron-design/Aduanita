import type { LucideIcon } from "lucide-react";
import { CircleUser, Files } from "lucide-react";

import { cn } from "@/lib/utils";

export type PanelLateral = "archivos" | "cuenta";

interface IconRailProps {
  /** `null` = panel lateral colapsado (ningun icono resaltado). */
  panelActivo: PanelLateral | null;
  onCambiarPanel: (panel: PanelLateral) => void;
}

const ITEMS: Array<{ id: PanelLateral; icono: LucideIcon; etiqueta: string }> = [
  { id: "archivos", icono: Files, etiqueta: "Despachos" },
  { id: "cuenta", icono: CircleUser, etiqueta: "Cuenta" },
];

/**
 * Columna angosta tipo VSCode con los botones-icono que alternan el panel
 * lateral (Explorador de despachos / Cuenta). Se monta dentro de la columna
 * de rail que arma `DashboardLayout` (que ademas coloca el logo arriba) --
 * este componente solo reporta que icono se clickeo; es `DashboardLayout`
 * quien decide colapsar el panel si se vuelve a clickear el icono ya
 * activo (ver `alternarPanel`).
 */
export function IconRail({ panelActivo, onCambiarPanel }: IconRailProps) {
  return (
    <nav className="flex flex-1 flex-col items-center gap-1 py-3" aria-label="Paneles laterales">
      {ITEMS.map(({ id, icono: Icono, etiqueta }) => {
        const activo = panelActivo === id;
        return (
          <button
            key={id}
            type="button"
            title={etiqueta}
            aria-label={etiqueta}
            aria-pressed={activo}
            onClick={() => onCambiarPanel(id)}
            className={cn(
              "flex size-10 items-center justify-center rounded-lg text-texto-secundario transition-colors",
              "hover:bg-surface-border/50 hover:text-texto",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activo && "bg-coral/15 text-coral hover:bg-coral/15 hover:text-coral",
            )}
          >
            <Icono className="size-5" />
          </button>
        );
      })}
    </nav>
  );
}
