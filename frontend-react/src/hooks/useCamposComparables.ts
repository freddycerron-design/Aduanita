import { useQuery } from "@tanstack/react-query";

import { listarCamposComparables } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Campos que una regla de validacion puede comparar, por tipo de
 * documento. Salen de los schemas del backend, solo cambian con un deploy. */
export function useCamposComparables() {
  return useQuery({
    queryKey: queryKeys.camposComparables(),
    queryFn: listarCamposComparables,
    staleTime: Infinity,
  });
}
