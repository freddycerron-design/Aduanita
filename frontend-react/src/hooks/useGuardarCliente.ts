import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { actualizarCliente, crearCliente } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ClienteUpsert } from "@/lib/types";

/** Crea o edita un importador según si se pasa `id` -- mismo patrón que
 * `useGuardarReglaValidacion`. */
export function useGuardarCliente() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: ClienteUpsert }) =>
      id ? actualizarCliente(id, datos) : crearCliente(datos),
    onSuccess: (_cliente, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clientes.list() });
      toast.success(variables.id ? "Cliente actualizado." : "Cliente creado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cliente.");
    },
  });
}
