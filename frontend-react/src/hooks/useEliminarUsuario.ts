import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { eliminarUsuario } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Elimina la cuenta de Auth por completo (borrado definitivo, no una
 * desactivación) -- el backend rechaza (400) eliminar al único ADMIN
 * restante. */
export function useEliminarUsuario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (idUsuario: string) => eliminarUsuario(idUsuario),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.usuarios.list() });
      toast.success("Usuario eliminado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el usuario.");
    },
  });
}
