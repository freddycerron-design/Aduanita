import { useQuery } from "@tanstack/react-query";

import { listarUsuarios } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Lista completa de usuarios (perfil + email, mezclados en el backend
 * desde perfiles_especialista + Supabase Auth). Mismo criterio que
 * `useReglasValidacion`: sin `staleTime: Infinity`. */
export function useUsuarios() {
  return useQuery({
    queryKey: queryKeys.usuarios.list(),
    queryFn: listarUsuarios,
  });
}
