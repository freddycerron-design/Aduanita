import { useQuery } from "@tanstack/react-query";

import { buscarEnArancel } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Búsqueda en el Arancel Nacional. `enabled` solo cuando hay consulta:
 * con la caja vacía no se llama al backend (que igual devolvería lista
 * vacía, pero así se evita el viaje). `staleTime` alto porque el arancel
 * cargado es estático -- se recarga con un script, no cambia entre
 * sesiones.
 */
export function useBuscarArancel(consulta: string) {
  const termino = consulta.trim();

  return useQuery({
    queryKey: queryKeys.arancel.busqueda(termino),
    queryFn: () => buscarEnArancel(termino),
    enabled: termino.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}
