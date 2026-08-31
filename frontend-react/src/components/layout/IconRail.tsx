import type { LucideIcon } from "lucide-react";
import { CircleUser, Files, ShieldCheck } from "lucide-react";
import { NavLink } from "react-router-dom";

import { esAdmin } from "@/lib/roles";
import type { Rol } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PanelLateral = "archivos" | "cuenta";

/** Un item del rail es "panel" (togglea el panel lateral angosto,
 * ver `DashboardLayout::alternarPanel`) o "route" (navega a una pagina
 * de ancho completo, p.ej. Administracion -- no tiene sentido como panel
 * angosto de 288px). */
type ItemPanel = { kind: "panel"; id: PanelLateral; icono: LucideIcon; etiqueta: string };
type ItemRuta = { kind: "route"; path: string; icono: LucideIcon; etiqueta: string };

interface IconRailProps {
  /** `null` = panel lateral colapsado (ningun icono de tipo "panel" resaltado). */
  panelActivo: PanelLateral | null;
  onCambiarPanel: (panel: PanelLateral) => void;
  /** Determina si el item "Administracion" se muestra -- solo ADMIN. */
  rol: Rol | null | undefined;
}

const ITEMS_PANEL: ItemPanel[] = [
  { kind: "panel", id: "archivos", icono: Files, etiqueta: "Despachos" },
  { kind: "panel", id: "cuenta", icono: CircleUser, etiqueta: "Cuenta" },
];

const ITEM_ADMIN: ItemRuta = {
  kind: "route",
  path: "/admin",
  icono: ShieldCheck,
  etiqueta: "Administración",
};

function clasesIcono(activo: boolean): string {
  return cn(
    "flex size-10 items-center justify-center rounded-lg text-texto-secundario transition-colors",
    "hover:bg-surface-border/50 hover:text-texto",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    activo && "bg-coral/15 text-coral hover:bg-coral/15 hover:text-coral",
  );
}

/**
 * Columna angosta tipo VSCode con los botones-icono del rail. Los items
 * "panel" (Despachos/Cuenta) togglean el panel lateral; el item "route"
 * (Administracion, solo visible para ADMIN) navega a una pagina de ancho
 * completo en vez de mostrarse como panel angosto. Se monta dentro de la
 * columna de rail que arma `DashboardLayout` (que ademas coloca el logo
 * arriba) -- este componente solo reporta que icono "panel" se clickeo;
 * es `DashboardLayout` quien decide colapsar el panel si se vuelve a
 * clickear el icono ya activo (ver `alternarPanel`).
 */
export function IconRail({ panelActivo, onCambiarPanel, rol }: IconRailProps) {
  const items: Array<ItemPanel | ItemRuta> = esAdmin(rol) ? [...ITEMS_PANEL, ITEM_ADMIN] : ITEMS_PANEL;

  return (
    <nav className="flex flex-1 flex-col items-center gap-1 py-3" aria-label="Paneles laterales">
      {items.map((item) => {
        if (item.kind === "panel") {
          const activo = panelActivo === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={item.etiqueta}
              aria-label={item.etiqueta}
              aria-pressed={activo}
              onClick={() => onCambiarPanel(item.id)}
              className={clasesIcono(activo)}
            >
              <item.icono className="size-5" />
            </button>
          );
        }
        return (
          <NavLink
            key={item.path}
            to={item.path}
            title={item.etiqueta}
            aria-label={item.etiqueta}
            className={({ isActive }) => clasesIcono(isActive)}
          >
            <item.icono className="size-5" />
          </NavLink>
        );
      })}
    </nav>
  );
}
