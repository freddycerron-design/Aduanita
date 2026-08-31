import { Outlet } from "react-router-dom";

// TODO(agente auth-shell): shell tipo VSCode real -- IconRail (Archivos/
// Cuenta) siempre visible + panel Explorer (buscar, agrupar por estado,
// crear despacho) o Cuenta (email + rol + logout) + <Outlet/> para el
// contenido del despacho activo. Placeholder temporal.
export function DashboardLayout() {
  return (
    <div className="flex h-dvh bg-background text-texto">
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
