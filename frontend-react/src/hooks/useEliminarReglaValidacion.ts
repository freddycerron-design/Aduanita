import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { eliminarReglaValidacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function useEliminarReglaValidacion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (idRegla: string) => eliminarReglaValidacion(idRegla),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reglasValidacion.list() });
      toast.success("Regla eliminada.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la regla.");
    },
  });
}
