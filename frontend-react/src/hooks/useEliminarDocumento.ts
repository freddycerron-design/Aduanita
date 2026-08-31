import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { eliminarDocumento } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { TipoDocumento } from "@/lib/types";

/**
 * Elimina el documento (PDF en Storage + fila en BD, ya lo hace el
 * endpoint) de un tipo dado para un despacho, e invalida el detalle para
 * que desaparezca de inmediato de la UI.
 */
export function useEliminarDocumento(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tipoDocumento: TipoDocumento) => eliminarDocumento(idDespacho, tipoDocumento),
    onSuccess: (_resultado, tipoDocumento) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      toast.success(`${tipoDocumento} eliminado.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el documento.");
    },
  });
}
