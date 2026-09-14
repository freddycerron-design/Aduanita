import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { procesarInformacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Dispara el pipeline completo (extraccion + validacion + clasificacion +
 * borrador) sobre todos los documentos pendientes de un despacho. Puede
 * tardar (llama a Gemini por cada documento) -- el llamador debe usar
 * `isPending` para mostrar un estado de carga claro.
 *
 * A diferencia de la version anterior de este hook, esto NO cambia el
 * estado del despacho (se queda en REVISION_DOC) -- se puede presionar
 * cuantas veces haga falta. La transicion a CLASIFICACION es una accion
 * aparte, ver `useEnviarAClasificacion`.
 */
export function useProcesarInformacion(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => procesarInformacion(idDespacho),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      toast.success("Procesamiento completo. Revisa la propuesta en la pestaña Clasificación.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo procesar el despacho.");
    },
  });
}
