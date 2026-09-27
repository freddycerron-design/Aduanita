import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { eliminarCliente } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Eliminar un importador NO borra sus despachos (quedan con el nombre en
 * texto libre y dejan de verse en el portal), pero SÍ elimina sus cuentas
 * de portal -- ver el endpoint en app/main.py. */
export function useEliminarCliente() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (idCliente: string) => eliminarCliente(idCliente),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clientes.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.usuarios.list() });
      toast.success("Cliente eliminado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el cliente.");
    },
  });
}
