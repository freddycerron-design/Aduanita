import type { LucideIcon } from "lucide-react";
import { BookOpen, CircleUser, FileCheck2, Home, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";

import { esAdmin } from "@/lib/roles";
import type { Rol } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ItemRuta {
  path: string;
  icono: LucideIcon;
  etiqueta: string;
}

interface IconRailProps {
  /** true = el panel de Cuenta está abierto. Es el único panel lateral
   * que queda (el Explorador dejó de ser uno -- ver DespachoPage), así
   * que no hace falta un tipo union para esto. */
  cuentaAbierta: boolean;
  onAlternarCuenta: () => void;
  /** Cerrar Cuenta al navegar a otra sección: es un panel aparte que no
   * tiene sentido dejar abierto sobre una página distinta. */
  onCerrarCuenta: () => void;
  /** Determina si el item "Configuración" se muestra -- solo ADMIN. */
  rol: Rol | null | undefined;
  /** true = barra ancha con icono + etiqueta de texto; false = solo
   * iconos centrados, togglea con el boton del logo en DashboardLayout. */
  expandido: boolean;
  /** Correo de la sesion activa, usado como etiqueta del item Cuenta en
   * vez de un nombre fijo -- "Cuenta" es el fallback mientras carga. */
  email: string | null | undefined;
}

const ITEM_HOME: ItemRuta = { path: "/", icono: Home, etiqueta: "Inicio" };

// Mismo icono que la tarjeta "Validador Documental (Docfy)" del Home
// (ver MODULOS en HomePage.tsx): es la misma sección, solo que aca se
// llama por su nombre corto.
const ITEM_VALIDADOR: ItemRuta = { path: "/despachos", icono: FileCheck2, etiqueta: "Validador" };

const ITEM_ARANCEL: ItemRuta = { path: "/aranceles", icono: BookOpen, etiqueta: "Aranceles" };

const ITEM_CONFIGURACION: ItemRuta = { path: "/admin", icono: Settings, etiqueta: "Configuración" };

/**
 * `resaltado` separa las dos cosas distintas que la barra puede estar
 * diciendo: "estás en esta sección" (coral, como mucho una a la vez) y
 * "el panel de Cuenta está abierto" (gris, no compite con la sección
 * activa).
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
 * sección con URL propia (Home, Validador, Aranceles, Configuración) --
 * la marca coral sale de la ruta actual y nunca hay dos secciones
 * marcadas a la vez.
 *
 * Cuenta va aparte, empujada al fondo con un spacer `mt-auto`: no es una
 * sección con página propia sino un panel lateral angosto, y se resalta
 * en gris para no competir con la sección activa. Se monta dentro de la
 * columna que arma `DashboardLayout` (que además coloca el botón del
 * logo arriba, con su propio toggle de `expandido`).
 */
export function IconRail({
  cuentaAbierta,
  onAlternarCuenta,
  onCerrarCuenta,
  rol,
  expandido,
  email,
}: IconRailProps) {
  const secciones: ItemRuta[] = esAdmin(rol)
    ? [ITEM_HOME, ITEM_VALIDADOR, ITEM_ARANCEL, ITEM_CONFIGURACION]
    : [ITEM_HOME, ITEM_VALIDADOR, ITEM_ARANCEL];

  const etiquetaCuenta = email ?? "Cuenta";

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
          onClick={onCerrarCuenta}
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
        onClick={onAlternarCuenta}
        className={clasesIcono(cuentaAbierta ? "panel" : "no", expandido)}
      >
        <CircleUser className="size-5 shrink-0" />
        {expandido && <span className="truncate text-sm font-medium">{etiquetaCuenta}</span>}
      </button>
    </nav>
  );
}
