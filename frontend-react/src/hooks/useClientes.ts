import { useQuery } from "@tanstack/react-query";

import { listarClientes } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Lista de importadores registrados. La usan el CRUD de Administración,
 * el selector de cliente al crear un despacho y el formulario de usuarios
 * (para vincular una cuenta de portal a su importador). */
export function useClientes() {
  return useQuery({
    queryKey: queryKeys.clientes.list(),
    queryFn: listarClientes,
  });
}
