import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";

import { useProfile } from "@/hooks/useProfile";

type Superficie = "interna" | "portal";

/**
 * Guard de superficie: manda a cada cuenta a donde le corresponde.
 *
 * El sistema tiene dos superficies que no se mezclan: la interna (equipo
 * de la agencia) y el portal (importadores, rol CLIENTE). Este guard
 * redirige en vez de mostrar un error, para que nadie termine en una
 * pantalla vacía o con la barra lateral de un sistema que no le
 * corresponde.
 *
 * Es solo comodidad de navegación: el backend rechaza igual cualquier
 * llamada cruzada (`get_current_staff`/`get_current_cliente` en
 * app/main.py) y las RLS policies acotan la lectura directa. La
 * seguridad real no depende de esto.
 */
export function RequireSurface({
  superficie,
  children,
}: {
  superficie: Superficie;
  children: ReactElement;
}): ReactElement | null {
  const { data: perfil, isLoading } = useProfile();

  // Mientras no se sepa el rol no se decide nada: redirigir a ciegas
  // provocaría un rebote entre las dos superficies en cada refresh.
  if (isLoading || !perfil) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-texto-secundario">
        Cargando...
      </div>
    );
  }

  const esCliente = perfil.rol === "CLIENTE";

  if (superficie === "interna" && esCliente) {
    return <Navigate to="/portal" replace />;
  }
  if (superficie === "portal" && !esCliente) {
    return <Navigate to="/" replace />;
  }

  return children;
}
