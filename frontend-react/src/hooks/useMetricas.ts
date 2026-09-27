import { useQuery } from "@tanstack/react-query";

import { obtenerMetricas } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Agregados de la pantalla de inicio (despachos por estado + hallazgos
 * críticos abiertos). Cambian cada vez que alguien procesa o decide un
 * despacho, así que no se cachean agresivamente. */
export function useMetricas() {
  return useQuery({
    queryKey: queryKeys.metricas(),
    queryFn: obtenerMetricas,
  });
}
