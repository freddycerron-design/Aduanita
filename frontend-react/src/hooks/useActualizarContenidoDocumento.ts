import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { actualizarContenidoDocumento } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { TipoDocumento } from "@/lib/types";

interface ActualizarContenidoVariables {
  tipoDocumento: TipoDocumento;
  contenidoJson: Record<string, unknown>;
}

/**
 * Guarda una correccion manual de los datos que el modelo leyo de un
 * documento. Invalida el detalle completo del despacho, no solo el
 * documento: al guardar, el backend rehace la validacion cruzada, asi que
 * los hallazgos de la pestaña de revision tambien cambian.
 */
export function useActualizarContenidoDocumento(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tipoDocumento, contenidoJson }: ActualizarContenidoVariables) =>
      actualizarContenidoDocumento(idDespacho, tipoDocumento, contenidoJson),
    onSuccess: (_documento, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      toast.success(`${variables.tipoDocumento} corregido. Se recalcularon las discrepancias.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los cambios.");
    },
  });
}
