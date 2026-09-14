import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { calcularPreliquidacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { CalcularPreliquidacionRequest } from "@/lib/types";

/**
 * Calcula (o recalcula) los tributos del despacho -- backend hace upsert
 * en `preliquidaciones`, se puede presionar "Calcular" cuantas veces haga
 * falta (p.ej. tras corregir el Valor CIF). Invalida la query de
 * pre-liquidacion propia y el detalle del despacho (que tambien incluye
 * el snapshot, usado por la exportacion a Excel).
 */
export function useCalcularPreliquidacion(idDespacho: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (datos: CalcularPreliquidacionRequest) => calcularPreliquidacion(idDespacho, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.preliquidacion.detail(idDespacho) });
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      toast.success("Pre-liquidación calculada.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo calcular la pre-liquidación.");
    },
  });
}
