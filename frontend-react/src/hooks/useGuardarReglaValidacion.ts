import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { actualizarReglaValidacion, crearReglaValidacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ReglaValidacionUpsert } from "@/lib/types";

/** Crea o edita una regla de validacion segun si se le pasa un `id` al
 * mutar -- un solo hook para las dos acciones del formulario del admin
 * (mismo patron que "un dialog, un boton Guardar" del resto del app). */
export function useGuardarReglaValidacion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: ReglaValidacionUpsert }) =>
      id ? actualizarReglaValidacion(id, datos) : crearReglaValidacion(datos),
    onSuccess: (_regla, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reglasValidacion.list() });
      toast.success(variables.id ? "Regla actualizada." : "Regla creada.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la regla.");
    },
  });
}
