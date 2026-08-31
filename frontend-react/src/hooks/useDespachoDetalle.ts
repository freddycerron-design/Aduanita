import { useQuery } from "@tanstack/react-query";

import { obtenerDespacho } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Detalle completo de un despacho: datos base, documentos, validaciones,
 * clasificacion (cache en memoria del backend, puede venir null) y
 * decision ya persistida (fallback para despachos cerrados). Todas las
 * pantallas del despacho activo leen de esta misma query -- las mutaciones
 * (subir documento, procesar, decidir, editar borrador) invalidan
 * `queryKeys.despachos.detail(id)` para refrescarla. */
export function useDespachoDetalle(idDespacho: string | undefined) {
  return useQuery({
    queryKey: queryKeys.despachos.detail(idDespacho ?? ""),
    queryFn: () => obtenerDespacho(idDespacho as string),
    enabled: !!idDespacho,
  });
}
