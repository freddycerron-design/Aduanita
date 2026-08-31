import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { enviarAClasificacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Dispara el pipeline completo (extraccion + validacion + clasificacion +
 * borrador) sobre todos los documentos pendientes de un despacho. Puede
 * tardar (llama a Gemini por cada documento) -- el llamador debe usar
 * `isPending` para mostrar un estado de carga claro.
 *
 * Invalida tanto el detalle del despacho como la lista: el estado pasa de
 * REVISION_DOC a CLASIFICACION, lo que afecta el agrupado del Explorer.
 */
export function useEnviarAClasificacion(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => enviarAClasificacion(idDespacho),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.list() });
      toast.success("Procesamiento completo. Revisa la pestaña Clasificación.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo procesar el despacho.");
    },
  });
}
