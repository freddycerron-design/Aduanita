import { useQuery } from "@tanstack/react-query";

import { listarGestoresDistintosDeDespachos } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthStore } from "@/hooks/useAuthStore";

/** Gestores que crearon al menos un despacho, para poblar el filtro
 * "estilo Excel" de esa columna en `ExploradorTab`. */
export function useGestoresDistintosDeDespachos() {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: queryKeys.despachos.gestoresDistintos(),
    queryFn: listarGestoresDistintosDeDespachos,
    enabled: status === "authenticated",
  });
}
