import type { LucideIcon } from "lucide-react";
import { BookOpen, CircleUser, Files, Home, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";

import { esAdmin } from "@/lib/roles";
import type { Rol } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PanelLateral = "archivos" | "cuenta";

/** Un item del rail es "panel" (togglea el panel lateral angosto,
 * ver `DashboardLayout::alternarPanel`) o "route" (navega a una pagina
 * de ancho completo, p.ej. Home/Administracion -- no tiene sentido como
 * panel angosto de 288px). */
type ItemPanel = { kind: "panel"; id: PanelLateral; icono: LucideIcon; etiqueta: string };
type ItemRuta = { kind: "route"; path: string; icono: LucideIcon; etiqueta: string };

interface IconRailProps {
  /** `null` = panel lateral colapsado (ningun icono de tipo "panel" resaltado). */
  panelActivo: PanelLateral | null;
  onCambiarPanel: (panel: PanelLateral) => void;
  /** Determina si el item "Configuracion" se muestra -- solo ADMIN. */
  rol: Rol | null | undefined;
  /** true = barra ancha con icono + etiqueta de texto; false = solo
   * iconos centrados (modo actual), togglea con el boton del logo en
   * DashboardLayout. */
  expandido: boolean;
  /** Correo de la sesion activa, usado como etiqueta del item Cuenta en
   * vez de un nombre fijo -- "Cuenta" es el fallback mientras carga. */
  email: string | null | undefined;
}

const ITEM_HOME: ItemRuta = { kind: "route", path: "/", icono: Home, etiqueta: "Home" };

const ITEMS_PANEL: ItemPanel[] = [{ kind: "panel", id: "archivos", icono: Files, etiqueta: "Explorador" }];

const ITEM_ARANCEL: ItemRuta = {
  kind: "route",
  path: "/aranceles",
  icono: BookOpen,
  etiqueta: "Aranceles",
};

const ITEM_CUENTA: ItemPanel = { kind: "panel", id: "cuenta", icono: CircleUser, etiqueta: "Cuenta" };

const ITEM_CONFIGURACION: ItemRuta = {
  kind: "route",
  path: "/admin",
  icono: Settings,
  etiqueta: "Configuración",
};

function clasesIcono(activo: boolean, expandido: boolean): string {
  return cn(
    "flex items-center rounded-lg text-texto-secundario transition-colors",
    "hover:bg-surface-border/50 hover:text-texto",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    expandido ? "h-10 w-full justify-start gap-3 px-3" : "size-10 justify-center",
    activo && "bg-coral/15 text-coral hover:bg-coral/15 hover:text-coral",
  );
}

/**
 * Columna del rail lateral tipo VSCode. Los items "panel" (Explorador/
 * Cuenta) togglean el panel lateral angosto; los items "route" (Home,
 * Configuracion) navegan a una pagina de ancho completo. Cuenta se
 * renderiza aparte, empujada al fondo con un spacer `mt-auto` -- siempre
 * es el ultimo item de la barra, sin importar el rol. Se monta dentro de
 * la columna de rail que arma `DashboardLayout` (que ademas coloca el
 * boton del logo arriba, con su propio toggle de `expandido`).
 */
export function IconRail({ panelActivo, onCambiarPanel, rol, expandido, email }: IconRailProps) {
  const itemsSuperiores: Array<ItemPanel | ItemRuta> = esAdmin(rol)
    ? [ITEM_HOME, ...ITEMS_PANEL, ITEM_ARANCEL, ITEM_CONFIGURACION]
    : [ITEM_HOME, ...ITEMS_PANEL, ITEM_ARANCEL];

  function renderizarItem(item: ItemPanel | ItemRuta) {
    if (item.kind === "panel") {
      const activo = panelActivo === item.id;
      const etiqueta = item.id === "cuenta" ? (email ?? item.etiqueta) : item.etiqueta;
      return (
        <button
          key={item.id}
          type="button"
          title={etiqueta}
          aria-label={etiqueta}
          aria-pressed={activo}
          onClick={() => onCambiarPanel(item.id)}
          className={clasesIcono(activo, expandido)}
        >
          <item.icono className="size-5 shrink-0" />
          {expandido && <span className="truncate text-sm font-medium">{etiqueta}</span>}
        </button>
      );
    }
    return (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.path === "/"}
        title={item.etiqueta}
        aria-label={item.etiqueta}
        className={({ isActive }) => clasesIcono(isActive, expandido)}
      >
        <item.icono className="size-5 shrink-0" />
        {expandido && <span className="truncate text-sm font-medium">{item.etiqueta}</span>}
      </NavLink>
    );
  }

  return (
    <nav className="flex flex-1 flex-col items-stretch gap-1 overflow-y-auto px-2 py-3" aria-label="Navegación principal">
      {itemsSuperiores.map(renderizarItem)}
      <div className="mt-auto" />
      {renderizarItem(ITEM_CUENTA)}
    </nav>
  );
}
