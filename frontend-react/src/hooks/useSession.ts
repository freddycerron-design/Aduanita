import { useEffect } from "react";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/hooks/useAuthStore";

/**
 * Inicializa el store de auth con la sesion actual y se suscribe a
 * `onAuthStateChange` (login, logout, refresh de token en otra pestana,
 * refresco silencioso automatico via autoRefreshToken). Se monta una sola
 * vez en la raiz de la app (ver App.tsx).
 */
export function useSession(): void {
  const setSession = useAuthStore((state) => state.setSession);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch((error: unknown) => {
        // Sin esto, un fallo de red/URL invalida deja el status en
        // "loading" para siempre -- RequireAuth se queda mostrando
        // "Cargando sesion..." de por vida en vez de caer al login.
        // Falla "abierto" hacia unauthenticated: peor caso es pedir login
        // de nuevo, no un colgado silencioso.
        console.error("No se pudo obtener la sesion inicial de Supabase:", error);
        setSession(null);
      });

    const { data: subscripcion } = supabase.auth.onAuthStateChange((_evento, session) => {
      setSession(session);
    });

    return () => subscripcion.subscription.unsubscribe();
  }, [setSession]);
}
