import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { enviarAClasificacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Botón propio "Enviar a Clasificación": la única transición
 * REVISION_DOC -> CLASIFICACION (ver `useProcesarInformacion` para el
 * pipeline de extracción/validación/clasificación en sí, que ya no mueve
 * el estado). Invalida tanto el detalle del despacho como la lista: el
 * Explorer agrupa por estado, este despacho se mueve de grupo.
 */
export function useEnviarAClasificacion(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => enviarAClasificacion(idDespacho),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.list() });
      toast.success("Despacho enviado a Clasificación.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar a clasificación.");
    },
  });
}
