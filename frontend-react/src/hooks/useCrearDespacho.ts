import { useMutation, useQueryClient } from "@tanstack/react-query";

import { crearDespacho } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Crea un despacho nuevo e invalida la lista para que aparezca agrupado
 * de inmediato en el Explorer (estado inicial REVISION_DOC). */
export function useCrearDespacho() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: crearDespacho,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.list() });
    },
  });
}
