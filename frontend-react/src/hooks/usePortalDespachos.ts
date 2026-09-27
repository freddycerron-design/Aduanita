import { useQuery } from "@tanstack/react-query";

import { listarDespachosPortal } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/** Despachos del importador autenticado (portal externo). El backend
 * filtra por el cliente del perfil: acá no se manda ningún id. */
export function usePortalDespachos() {
  return useQuery({
    queryKey: queryKeys.portal.despachos(),
    queryFn: listarDespachosPortal,
  });
}
