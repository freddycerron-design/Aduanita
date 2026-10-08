import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { eliminarTipoCambio, guardarTipoCambio, listarTiposCambio, sincronizarTipoCambio } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { TipoCambioUpsert } from "@/lib/types";

/** Tipos de cambio guardados, el más reciente primero. */
export function useTiposCambio() {
  return useQuery({
    queryKey: queryKeys.tiposCambio.list(),
    queryFn: listarTiposCambio,
  });
}

export function useSincronizarTipoCambio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sincronizarTipoCambio,
    onSuccess: (tipoCambio) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tiposCambio.list() });
      toast.success(`Tipo de cambio del ${tipoCambio.fecha} guardado: venta S/ ${tipoCambio.venta.toFixed(3)}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo obtener el tipo de cambio de SUNAT.");
    },
  });
}

export function useGuardarTipoCambio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fecha, datos }: { fecha: string; datos: TipoCambioUpsert }) => guardarTipoCambio(fecha, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tiposCambio.list() });
      toast.success("Tipo de cambio guardado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el tipo de cambio.");
    },
  });
}

export function useEliminarTipoCambio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fecha: string) => eliminarTipoCambio(fecha),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tiposCambio.list() });
      toast.success("Tipo de cambio eliminado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el tipo de cambio.");
    },
  });
}
