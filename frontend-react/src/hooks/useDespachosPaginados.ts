import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { listarDespachos } from "@/lib/api";
import type { ListarDespachosParams } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthStore } from "@/hooks/useAuthStore";

/** Listado paginado, buscable, filtrable y ordenable de despachos, para
 * la pestaña Explorador (`ExploradorTab`). Todo eso es del backend (ver
 * `GET /despachos`), no un filtro/orden client-side -- cada combinación
 * de página/búsqueda/filtros/orden tiene su propia entrada en cache (ver
 * `queryKeys.despachos.list`). `placeholderData: keepPreviousData` evita
 * que la grilla parpadee a un skeleton al cambiar de página o filtro:
 * mientras llega la respuesta nueva, se sigue viendo la anterior. */
export function useDespachosPaginados(params: ListarDespachosParams) {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: queryKeys.despachos.list(params),
    queryFn: () => listarDespachos(params),
    enabled: status === "authenticated",
    placeholderData: keepPreviousData,
  });
}
