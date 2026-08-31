import { useMutation, useQueryClient } from "@tanstack/react-query";

import { registrarDecision } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { DecisionRequest } from "@/lib/types";

/**
 * Registra la decision del liquidador (REVISADO/OBSERVADO) sobre la
 * propuesta de clasificacion de un despacho. Al exito invalida tanto el
 * detalle del despacho (su estado cambia y la clasificacion en memoria se
 * limpia en el backend, ver `DespachoDetalleOut.clasificacion`) como la
 * lista (el Explorer agrupa por estado, este despacho se mueve de grupo).
 */
export function useRegistrarDecision(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (datos: DecisionRequest) => registrarDecision(idDespacho, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.list() });
    },
  });
}
