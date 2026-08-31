import { useState } from "react";
import { Outlet, useMatch } from "react-router-dom";

import logo from "@/assets/logo_aduanita.webp";
import { AccountPanel } from "@/components/layout/AccountPanel";
import { ExplorerPanel } from "@/components/layout/ExplorerPanel";
import type { PanelLateral } from "@/components/layout/IconRail";
import { IconRail } from "@/components/layout/IconRail";

/**
 * Shell tipo VSCode: columna de iconos siempre visible (con el logo
 * arriba) + panel lateral condicional (Explorer de despachos o Cuenta) +
 * el despacho activo (o el estado vacio) ocupando el resto via <Outlet/>.
 */
export function DashboardLayout() {
  const [panelActivo, setPanelActivo] = useState<PanelLateral>("archivos");

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
        <IconRail panelActivo={panelActivo} onCambiarPanel={setPanelActivo} />
      </div>

      <div className="w-72 shrink-0 overflow-y-auto border-r border-border">
        {panelActivo === "archivos" ? (
          <ExplorerPanel idDespachoActivo={idDespachoActivo} />
        ) : (
          <AccountPanel />
        )}
      </div>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
