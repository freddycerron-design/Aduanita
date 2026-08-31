import { useState } from "react";
import { Outlet, useMatch } from "react-router-dom";

import logo from "@/assets/logo_aduanita.webp";
import { AccountPanel } from "@/components/layout/AccountPanel";
import { ExplorerPanel } from "@/components/layout/ExplorerPanel";
import type { PanelLateral } from "@/components/layout/IconRail";
import { IconRail } from "@/components/layout/IconRail";
import { cn } from "@/lib/utils";

/**
 * Shell tipo VSCode: columna de iconos siempre visible (con el logo
 * arriba) + panel lateral colapsable (Explorador de despachos o Cuenta) +
 * el despacho activo (o el estado vacio) ocupando el resto via <Outlet/>.
 */
export function DashboardLayout() {
  // `null` = panel lateral colapsado. Arranca en "archivos" (Explorador
  // visible por defecto).
  const [panelActivo, setPanelActivo] = useState<PanelLateral | null>("archivos");

  // Clickear el icono ya activo lo colapsa (mismo comportamiento que el
  // Explorer de VSCode); clickear el otro icono, o el mismo estando
  // colapsado, lo abre.
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
      <div className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-surface">
        <img src={logo} alt="AduANITA" className="mt-4 w-10" />
        <IconRail panelActivo={panelActivo} onCambiarPanel={alternarPanel} />
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
