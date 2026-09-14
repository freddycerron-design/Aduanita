import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { actualizarUsuario } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { UsuarioUpdate } from "@/lib/types";

/** Edita nombre/rol/activo de un usuario, y opcionalmente resetea su
 * contraseña si `datos.password` viene con un valor. El backend rechaza
 * (400) degradar o eliminar al único ADMIN restante. */
export function useActualizarUsuario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: UsuarioUpdate }) => actualizarUsuario(id, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.usuarios.list() });
      toast.success("Usuario actualizado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el usuario.");
    },
  });
}
