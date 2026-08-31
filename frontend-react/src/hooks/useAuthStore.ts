import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  session: Session | null;
  status: AuthStatus;
  setSession: (session: Session | null) => void;
}

/**
 * Estado minimo de cliente (sesion de Supabase + status de inicializacion).
 * El rol del usuario NO vive aqui -- se trata como server state via
 * `useProfile` (TanStack Query) para no duplicar una fuente de verdad que
 * ya vive en `perfiles_especialista`. Ver `useSession` para como se
 * mantiene sincronizado con `supabase.auth.onAuthStateChange`.
 */
export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  status: "loading",
  setSession: (session) => set({ session, status: session ? "authenticated" : "unauthenticated" }),
}));
