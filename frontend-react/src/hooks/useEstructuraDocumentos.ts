import { useQuery } from "@tanstack/react-query";

import { obtenerEstructuraDocumentos } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Datos de cabecera y detalle que extrae cada tipo de documento. Salen de
 * los schemas del backend, solo cambian con un deploy. */
export function useEstructuraDocumentos() {
  return useQuery({
    queryKey: queryKeys.estructuraDocumentos(),
    queryFn: obtenerEstructuraDocumentos,
    staleTime: Infinity,
  });
}
