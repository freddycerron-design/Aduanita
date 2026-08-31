import { useQuery } from "@tanstack/react-query";

import { listarDespachos } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthStore } from "@/hooks/useAuthStore";

/** Lista completa de despachos (sin filtro de estado -- el agrupado por
 * estado y la busqueda por numero se hacen client-side sobre esta misma
 * query cacheada, ver ExplorerPanel). */
export function useDespachos() {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: queryKeys.despachos.list(),
    queryFn: () => listarDespachos(),
    enabled: status === "authenticated",
  });
}
