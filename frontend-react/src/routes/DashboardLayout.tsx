import { useState } from "react";
import { Outlet, useMatch } from "react-router-dom";

import logo from "@/assets/logo_aduafy.webp";
import { AccountPanel } from "@/components/layout/AccountPanel";
import { ExplorerPanel } from "@/components/layout/ExplorerPanel";
import type { PanelLateral } from "@/components/layout/IconRail";
import { IconRail } from "@/components/layout/IconRail";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";

/**
 * Shell tipo VSCode: columna de iconos siempre visible (con el logo
 * arriba) + panel lateral colapsable (Explorador de despachos o Cuenta) +
 * el despacho activo (o el Home/estado vacio) ocupando el resto via
 * <Outlet/>.
 */
export function DashboardLayout() {
  // `null` = panel lateral colapsado. Arranca colapsado -- Home (la
  // pagina de entrada) se ve mejor a ancho completo; el usuario abre el
  // Explorador cuando lo necesita.
  const [panelActivo, setPanelActivo] = useState<PanelLateral | null>(null);
  // true = rail ancho con icono + etiqueta de texto (modo por defecto);
  // false = solo iconos centrados, togglea con el boton del logo.
  const [railExpandido, setRailExpandido] = useState(true);
  const { data: perfil } = useProfile();
  const email = useAuthStore((state) => state.session?.user.email);

  // Clickear el icono ya activo lo colapsa (mismo comportamiento que el
  // Explorer de VSCode); clickear el otro icono, o el mismo estando
  // colapsado, lo abre. Usado por Cuenta (panel puro) y por Explorador
  // cuando ya estás dentro de esa sección (ver IconRail::alClickSeccion).
  function alternarPanel(panel: PanelLateral) {
    setPanelActivo((actual) => (actual === panel ? null : panel));
  }

  // La ruta anidada "despachos/:id" se renderiza dentro del <Outlet/> de
  // este layout (ver App.tsx), asi que useParams() aqui no la veria --
  // solo alcanza los matches hasta el propio nivel de este componente.
  // useMatch matchea directo contra la ubicacion actual sin depender de
  // esa jerarquia, y es lo que necesita ExplorerPanel para resaltar el
  // despacho abierto.
  const matchDespacho = useMatch("/despachos/:id");
  const idDespachoActivo = matchDespacho?.params.id;

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
          panelActivo={panelActivo}
          onAlternarPanel={alternarPanel}
          onFijarPanel={setPanelActivo}
          rol={perfil?.rol}
          expandido={railExpandido}
          email={email}
        />
      </div>

      <div
        className={cn(
          "shrink-0 overflow-hidden border-border transition-[width] duration-200 ease-in-out",
          panelActivo ? "w-72 border-r" : "w-0 border-r-0",
        )}
      >
        {/* w-72 fijo adentro (no 100%): al colapsar, el contenedor de
            afuera se achica a 0 y w-72 hace que esto se "deslice" hacia la
            izquierda en vez de reflow/aplastarse, para que la transicion
            de ancho se vea como un collapse real. */}
        <div className="h-full w-72 overflow-y-auto">
          {panelActivo === "archivos" && <ExplorerPanel idDespachoActivo={idDespachoActivo} />}
          {panelActivo === "cuenta" && <AccountPanel />}
        </div>
      </div>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
