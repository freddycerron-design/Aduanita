import { useQuery } from "@tanstack/react-query";

import { listarReglasValidacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Lista completa de reglas de validacion (activas e inactivas -- el
 * filtrado/orden para la tabla del admin se hace client-side). No usa
 * `staleTime: Infinity` como `useProfile`: un admin puede tener el CRUD
 * abierto en dos pestanas, conviene revalidar con normalidad. */
export function useReglasValidacion() {
  return useQuery({
    queryKey: queryKeys.reglasValidacion.list(),
    queryFn: listarReglasValidacion,
  });
}
