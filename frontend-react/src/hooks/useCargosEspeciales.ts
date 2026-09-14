import { useQuery } from "@tanstack/react-query";

import { listarCargosEspeciales } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Lista completa de cargos especiales del arancel (antidumping / derecho
 * especifico por subpartida). Mismo criterio que `useReglasValidacion`:
 * sin `staleTime: Infinity`, un admin puede tener el CRUD abierto en dos
 * pestanas. */
export function useCargosEspeciales() {
  return useQuery({
    queryKey: queryKeys.cargosEspeciales.list(),
    queryFn: listarCargosEspeciales,
  });
}
