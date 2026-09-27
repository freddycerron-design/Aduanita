import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { listarDespachos } from "@/lib/api";
import type { ParametrosListaDespachos } from "@/lib/queryKeys";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthStore } from "@/hooks/useAuthStore";

/** Listado paginado y buscable de despachos, para la pestaña Explorador
 * (`ExploradorTab`). La búsqueda y la paginación son del backend (ver
 * `GET /despachos`), no un filtro client-side -- cada combinación de
 * página/búsqueda tiene su propia entrada en cache (ver
 * `queryKeys.despachos.list`). `placeholderData: keepPreviousData` evita
 * que la grilla parpadee a un skeleton al cambiar de página: mientras
 * llega la siguiente, se sigue viendo la anterior. */
export function useDespachosPaginados(params: ParametrosListaDespachos) {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: queryKeys.despachos.list(params),
    queryFn: () => listarDespachos(params),
    enabled: status === "authenticated",
    placeholderData: keepPreviousData,
  });
}
