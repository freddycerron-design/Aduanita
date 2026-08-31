import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import type { PerfilEspecialista } from "@/lib/types";
import { useAuthStore } from "@/hooks/useAuthStore";

async function obtenerPerfil(userId: string): Promise<PerfilEspecialista> {
  const { data, error } = await supabase
    .from("perfiles_especialista")
    .select("id, nombre_completo, rol, activo")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data as PerfilEspecialista;
}

/** Rol del usuario autenticado (ESPECIALISTA/LIQUIDADOR/ADMIN), leido de
 * `perfiles_especialista` -- RLS permite a cualquier autenticado leer esa
 * tabla, igual que en el dashboard de Streamlit. `staleTime: Infinity`
 * porque el rol no cambia durante una sesion; se re-consulta solo si
 * cambia el usuario logueado (la queryKey incluye el userId). */
export function useProfile() {
  const userId = useAuthStore((state) => state.session?.user.id);

  return useQuery({
    queryKey: queryKeys.perfil(userId ?? ""),
    queryFn: () => obtenerPerfil(userId as string),
    enabled: !!userId,
    staleTime: Infinity,
  });
}
