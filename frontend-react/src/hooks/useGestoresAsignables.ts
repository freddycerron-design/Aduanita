import { useQuery } from "@tanstack/react-query";

import { listarGestoresAsignables } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthStore } from "@/hooks/useAuthStore";

/** GESTOR/ADMIN activos, para el Select de "gestor asignado" al crear un
 * despacho (`NuevoDespachoDialog`). A diferencia de
 * `useGestoresDistintosDeDespachos` (que solo lista a quien YA tiene
 * algún despacho, para el filtro de la grilla), esta lista incluye
 * también a alguien recién contratado que todavía no tiene ninguno. */
export function useGestoresAsignables() {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: queryKeys.despachos.gestoresAsignables(),
    queryFn: listarGestoresAsignables,
    enabled: status === "authenticated",
  });
}
