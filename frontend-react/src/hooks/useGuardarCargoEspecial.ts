import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { actualizarCargoEspecial, crearCargoEspecial } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { CargoEspecialArancelUpsert } from "@/lib/types";

/** Crea o edita un cargo especial segun si se le pasa un `id` al mutar --
 * mismo patron que `useGuardarReglaValidacion`. */
export function useGuardarCargoEspecial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: CargoEspecialArancelUpsert }) =>
      id ? actualizarCargoEspecial(id, datos) : crearCargoEspecial(datos),
    onSuccess: (_cargo, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cargosEspeciales.list() });
      toast.success(variables.id ? "Cargo especial actualizado." : "Cargo especial creado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cargo especial.");
    },
  });
}
