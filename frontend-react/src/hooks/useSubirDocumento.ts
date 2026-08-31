import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { subirDocumento } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { TipoDocumento } from "@/lib/types";

interface SubirDocumentoVariables {
  tipoDocumento: TipoDocumento;
  archivo: File;
}

/**
 * Sube el PDF de un tipo de documento para un despacho. Solo guarda el
 * archivo -- no extrae datos todavia (`procesado: false` en la respuesta),
 * eso ocurre en bloque al presionar "Procesar información". Un archivo
 * nuevo del mismo tipo reemplaza al anterior automaticamente (el backend
 * hace upsert), asi que este mismo hook sirve tanto para la primera carga
 * como para un reemplazo.
 */
export function useSubirDocumento(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tipoDocumento, archivo }: SubirDocumentoVariables) =>
      subirDocumento(idDespacho, tipoDocumento, archivo),
    onSuccess: (_documento, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      toast.success(`${variables.tipoDocumento} cargado.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo subir el documento.");
    },
  });
}
