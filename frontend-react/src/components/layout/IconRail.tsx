import type { MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { BookOpen, CircleUser, Files, Home, Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { esAdmin } from "@/lib/roles";
import type { Rol } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PanelLateral = "archivos" | "cuenta";

/** Un item del rail es "route" (una sección de la app: la barra marca
 * dónde estás, y solo una puede estarlo) o "panel" (Cuenta: abre el panel
 * lateral angosto sin moverte de página, por eso se resalta distinto). */
type ItemRuta = {
  kind: "route";
  path: string;
  icono: LucideIcon;
  etiqueta: string;
  /** Panel lateral que acompaña a esta sección. Sin esto, la sección se ve
   * a ancho completo y entrar cierra el panel que hubiera quedado abierto. */
  panel?: PanelLateral;
};
type ItemPanel = { kind: "panel"; id: PanelLateral; icono: LucideIcon; etiqueta: string };

interface IconRailProps {
  /** `null` = panel lateral colapsado. */
  panelActivo: PanelLateral | null;
  /** Abre el panel si está cerrado, lo cierra si ya estaba abierto. */
  onAlternarPanel: (panel: PanelLateral) => void;
  /** Deja el panel en un estado concreto, al entrar o salir de una sección. */
  onFijarPanel: (panel: PanelLateral | null) => void;
  /** Determina si el item "Configuración" se muestra -- solo ADMIN. */
  rol: Rol | null | undefined;
  /** true = barra ancha con icono + etiqueta de texto; false = solo
   * iconos centrados, togglea con el boton del logo en DashboardLayout. */
  expandido: boolean;
  /** Correo de la sesion activa, usado como etiqueta del item Cuenta en
   * vez de un nombre fijo -- "Cuenta" es el fallback mientras carga. */
  email: string | null | undefined;
}

const ITEM_HOME: ItemRuta = { kind: "route", path: "/", icono: Home, etiqueta: "Home" };

const ITEM_EXPLORADOR: ItemRuta = {
  kind: "route",
  path: "/despachos",
  icono: Files,
  etiqueta: "Explorador",
  panel: "archivos",
};

const ITEM_ARANCEL: ItemRuta = {
  kind: "route",
  path: "/aranceles",
  icono: BookOpen,
  etiqueta: "Aranceles",
};

const ITEM_CONFIGURACION: ItemRuta = {
  kind: "route",
  path: "/admin",
  icono: Settings,
  etiqueta: "Configuración",
};

const ITEM_CUENTA: ItemPanel = { kind: "panel", id: "cuenta", icono: CircleUser, etiqueta: "Cuenta" };

/**
 * `resaltado` separa las dos cosas distintas que la barra puede estar
 * diciendo: "estás en esta sección" (coral, como mucho una a la vez) y
 * "este panel está abierto" (gris, no te moviste de sección). Antes las
 * dos usaban el mismo coral, así que abrir un panel dejaba dos items
 * marcados como seleccionados al mismo tiempo.
 */
function clasesIcono(resaltado: "no" | "seccion" | "panel", expandido: boolean): string {
  return cn(
    "flex items-center rounded-lg text-texto-secundario transition-colors",
    "hover:bg-surface-border/50 hover:text-texto",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    expandido ? "h-10 w-full justify-start gap-3 px-3" : "size-10 justify-center",
    resaltado === "seccion" && "bg-coral/15 text-coral hover:bg-coral/15 hover:text-coral",
    resaltado === "panel" && "bg-surface-border text-texto hover:bg-surface-border",
  );
}

/**
 * Columna del rail lateral tipo VSCode. Cada item de arriba es una
 * sección con URL propia, así que la marca coral siempre sale de la ruta
 * actual y nunca hay dos secciones marcadas. El Explorador es la sección
 * de despachos: entrar desde otra página navega y abre su panel; volver a
 * clickearlo estando ya dentro colapsa o expande el panel sin navegar
 * (navegar cerraría el despacho que estuviera abierto).
 *
 * Cuenta va aparte, empujada al fondo con un spacer `mt-auto`: no es una
 * sección sino un panel, y se resalta en gris para no competir con la
 * sección activa. Se monta dentro de la columna que arma
 * `DashboardLayout` (que ademas coloca el boton del logo arriba, con su
 * propio toggle de `expandido`).
 */
export function IconRail({
  panelActivo,
  onAlternarPanel,
  onFijarPanel,
  rol,
  expandido,
  email,
}: IconRailProps) {
  const { pathname } = useLocation();

  const secciones: ItemRuta[] = esAdmin(rol)
    ? [ITEM_HOME, ITEM_EXPLORADOR, ITEM_ARANCEL, ITEM_CONFIGURACION]
    : [ITEM_HOME, ITEM_EXPLORADOR, ITEM_ARANCEL];

  /** true si ya estamos dentro de la sección, incluidas sus subrutas
   * (p.ej. /despachos/:id cuenta como Explorador). */
  function enSeccion(path: string): boolean {
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  function alClickSeccion(evento: MouseEvent, item: ItemRuta) {
    if (!item.panel) {
      // Sección a ancho completo: no dejar abierto el panel de otra.
      onFijarPanel(null);
      return;
    }
    if (enSeccion(item.path)) {
      evento.preventDefault(); // ya estamos acá: colapsar/expandir, no navegar
      onAlternarPanel(item.panel);
    } else {
      onFijarPanel(item.panel);
    }
  }

  const cuentaAbierta = panelActivo === "cuenta";
  const etiquetaCuenta = email ?? ITEM_CUENTA.etiqueta;

  return (
    <nav
      className="flex flex-1 flex-col items-stretch gap-1 overflow-y-auto px-2 py-3"
      aria-label="Navegación principal"
    >
      {secciones.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          onClick={(evento) => alClickSeccion(evento, item)}
          title={item.etiqueta}
          aria-label={item.etiqueta}
          className={({ isActive }) => clasesIcono(isActive ? "seccion" : "no", expandido)}
        >
          <item.icono className="size-5 shrink-0" />
          {expandido && <span className="truncate text-sm font-medium">{item.etiqueta}</span>}
        </NavLink>
      ))}

      <div className="mt-auto" />

      <button
        type="button"
        title={etiquetaCuenta}
        aria-label={etiquetaCuenta}
        aria-pressed={cuentaAbierta}
        onClick={() => onAlternarPanel(ITEM_CUENTA.id)}
        className={clasesIcono(cuentaAbierta ? "panel" : "no", expandido)}
      >
        <ITEM_CUENTA.icono className="size-5 shrink-0" />
        {expandido && <span className="truncate text-sm font-medium">{etiquetaCuenta}</span>}
      </button>
    </nav>
  );
}
