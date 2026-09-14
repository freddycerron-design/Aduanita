import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { eliminarCargoEspecial } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useEliminarCargoEspecial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (idCargo: string) => eliminarCargoEspecial(idCargo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cargosEspeciales.list() });
      toast.success("Cargo especial eliminado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el cargo especial.");
    },
  });
}
