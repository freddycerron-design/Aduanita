import { useMutation, useQueryClient } from "@tanstack/react-query";

import { editarBorrador } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ActualizarBorradorRequest } from "@/lib/types";

/**
 * Guarda la edicion del cuerpo de un borrador de correo (PATCH
 * /borradores/{id}).
 *
 * Nota: `CorreoTabProps` (fijado por el orquestador del despacho,
 * `DespachoPage.tsx`) solo expone `borrador`, no `idDespacho`, asi que no
 * podemos invalidar `queryKeys.despachos.detail(idDespacho)` puntualmente
 * como hace `useRegistrarDecision`. En su lugar invalidamos
 * `queryKeys.despachos.list()`: por el matching por prefijo por defecto
 * de TanStack Query (`exact: false`), esa queryKey (`["despachos"]`)
 * tambien invalida cualquier query activa `["despachos", id]` --
 * incluida la del despacho abierto -- asi que el efecto practico es el
 * mismo que invalidar el detalle puntual.
 */
export function useEditarBorrador(idBorrador: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (datos: ActualizarBorradorRequest) => editarBorrador(idBorrador, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.list() });
    },
  });
}
