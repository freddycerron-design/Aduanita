import { useState } from "react";
import { Outlet } from "react-router-dom";

import logo from "@/assets/logo_aduafy.webp";
import { AccountPanel } from "@/components/layout/AccountPanel";
import { IconRail } from "@/components/layout/IconRail";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";

/**
 * Shell tipo VSCode: columna de iconos siempre visible (con el logo
 * arriba) + panel lateral colapsable de Cuenta + la sección activa
 * (Home, Validador, Aranceles o Configuración) ocupando el resto via
 * <Outlet/>. El Explorador de despachos dejó de vivir en un panel lateral
 * angosto: ahora es una pestaña más dentro de la sección Validador (ver
 * DespachoPage/ExploradorTab), así que Cuenta es el único panel que
 * queda acá.
 */
export function DashboardLayout() {
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  // true = rail ancho con icono + etiqueta de texto (modo por defecto);
  // false = solo iconos centrados, togglea con el boton del logo.
  const [railExpandido, setRailExpandido] = useState(true);
  const { data: perfil } = useProfile();
  const email = useAuthStore((state) => state.session?.user.email);

  return (
    <div className="flex h-dvh bg-background text-texto">
      <div
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-in-out",
          railExpandido ? "w-56" : "w-14",
        )}
      >
        <button
          type="button"
          onClick={() => setRailExpandido((actual) => !actual)}
          title="Aduafy"
          aria-label={railExpandido ? "Colapsar la barra lateral" : "Expandir la barra lateral"}
          className={cn(
            "mx-2 mt-3 flex items-center gap-2.5 rounded-lg px-2 py-2 text-texto transition-colors",
            "hover:bg-surface-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !railExpandido && "justify-center px-0",
          )}
        >
          <img src={logo} alt="" className="w-8 shrink-0" />
          {railExpandido && <span className="truncate text-sm font-bold">Aduafy</span>}
        </button>
        <IconRail
          cuentaAbierta={cuentaAbierta}
          onAlternarCuenta={() => setCuentaAbierta((actual) => !actual)}
          onCerrarCuenta={() => setCuentaAbierta(false)}
          rol={perfil?.rol}
          expandido={railExpandido}
          email={email}
        />
      </div>

      <div
        className={cn(
          "shrink-0 overflow-hidden border-border transition-[width] duration-200 ease-in-out",
          cuentaAbierta ? "w-72 border-r" : "w-0 border-r-0",
        )}
      >
        {/* w-72 fijo adentro (no 100%): al colapsar, el contenedor de
            afuera se achica a 0 y w-72 hace que esto se "deslice" hacia la
            izquierda en vez de reflow/aplastarse, para que la transicion
            de ancho se vea como un collapse real. */}
        <div className="h-full w-72 overflow-y-auto">{cuentaAbierta && <AccountPanel />}</div>
      </div>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
