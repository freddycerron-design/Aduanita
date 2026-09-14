import { useQuery } from "@tanstack/react-query";

import { obtenerPreliquidacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Trae la pre-liquidacion ya calculada (si existe) + la subpartida
 * vigente + el default de cargos_especiales_arancel, todo en una sola
 * llamada (ver `PreliquidacionDetalleOut`). Consulta propia (no viaja
 * dentro de `useDespachoDetalle`) para poder refetchear justo tras
 * "Calcular" sin invalidar el resto del detalle del despacho.
 */
export function usePreliquidacion(idDespacho: string) {
  return useQuery({
    queryKey: queryKeys.preliquidacion.detail(idDespacho),
    queryFn: () => obtenerPreliquidacion(idDespacho),
  });
}
