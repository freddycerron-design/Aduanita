import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { agregarPartidaFavorita, listarPartidasFavoritas, quitarPartidaFavorita } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { SubpartidaArancelaria } from "@/lib/types";

/** Subpartidas favoritas del usuario, la más reciente primero. */
export function usePartidasFavoritas() {
  return useQuery({
    queryKey: queryKeys.arancel.favoritos(),
    queryFn: listarPartidasFavoritas,
  });
}

/** Marca o desmarca una subpartida. Actualiza la lista en cache antes de
 * que responda el backend para que la estrella cambie al instante, y la
 * revierte si falla. */
export function useAlternarFavorito() {
  const queryClient = useQueryClient();
  const clave = queryKeys.arancel.favoritos();

  return useMutation({
    mutationFn: ({ partida, marcar }: { partida: SubpartidaArancelaria; marcar: boolean }) =>
      marcar ? agregarPartidaFavorita(partida.codigo) : quitarPartidaFavorita(partida.codigo),
    onMutate: async ({ partida, marcar }) => {
      await queryClient.cancelQueries({ queryKey: clave });
      const anterior = queryClient.getQueryData<SubpartidaArancelaria[]>(clave);
      queryClient.setQueryData<SubpartidaArancelaria[]>(clave, (actual = []) =>
        marcar
          ? [partida, ...actual.filter((p) => p.codigo !== partida.codigo)]
          : actual.filter((p) => p.codigo !== partida.codigo),
      );
      return { anterior };
    },
    onError: (error, _variables, contexto) => {
      queryClient.setQueryData(clave, contexto?.anterior);
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el favorito.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: clave }),
  });
}
