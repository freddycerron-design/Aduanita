import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { descargarExcelDespacho } from "@/lib/api";
import { descargarBlob } from "@/lib/utils";

/** Pide el .xlsx al backend (unica exportacion que necesita ida y vuelta
 * al servidor -- la de JSON se arma client-side, ver
 * components/despacho/ExportarDespachoBotones.tsx) y dispara la
 * descarga apenas llega. */
export function useDescargarExcelDespacho() {
  return useMutation({
    mutationFn: async ({ idDespacho, numeroDespacho }: { idDespacho: string; numeroDespacho: string }) => {
      const blob = await descargarExcelDespacho(idDespacho);
      return { blob, numeroDespacho };
    },
    onSuccess: ({ blob, numeroDespacho }) => {
      descargarBlob(blob, `despacho_${numeroDespacho}.xlsx`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo descargar el Excel.");
    },
  });
}
