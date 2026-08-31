import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthStore } from "@/hooks/useAuthStore";

/** Guard de rutas: redirige a /login si no hay sesion, guardando la
 * ubicacion actual para volver ahi tras el login. Mientras la sesion
 * inicial todavia se esta resolviendo (status "loading") no redirige --
 * evita un parpadeo a /login en cada refresh de pagina mientras
 * `supabase.auth.getSession()` responde. */
export function RequireAuth({ children }: { children: ReactElement }): ReactElement | null {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Cargando sesion...
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
