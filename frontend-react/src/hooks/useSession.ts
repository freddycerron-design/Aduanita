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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: subscripcion } = supabase.auth.onAuthStateChange((_evento, session) => {
      setSession(session);
    });

    return () => subscripcion.subscription.unsubscribe();
  }, [setSession]);
}
