import { FileJson, FileSpreadsheet } from "lucide-react";

import { useDescargarExcelDespacho } from "@/hooks/useDescargarExcelDespacho";
import type { DespachoDetalleOut } from "@/lib/types";
import { descargarBlob } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Botones de exportar el despacho activo. JSON se arma client-side (el
 * `detalle` ya esta cargado en React Query, no hace falta pegarle de
 * nuevo al backend); Excel si necesita el backend (generar un .xlsx real
 * requiere una libreria server-side, ver services/export_service.py).
 */
export function ExportarDespachoBotones({ detalle }: { detalle: DespachoDetalleOut }) {
  const descargarExcel = useDescargarExcelDespacho();

  function exportarJson() {
    const blob = new Blob([JSON.stringify(detalle, null, 2)], { type: "application/json" });
    descargarBlob(blob, `despacho_${detalle.despacho.numero_despacho}.json`);
  }

  return (
    <div className="flex gap-1.5">
      <Button type="button" variant="outline" size="sm" onClick={exportarJson} title="Descargar JSON">
        <FileJson className="size-4" />
        JSON
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          descargarExcel.mutate({
            idDespacho: detalle.despacho.id,
            numeroDespacho: detalle.despacho.numero_despacho,
          })
        }
        disabled={descargarExcel.isPending}
        title="Descargar Excel"
      >
        <FileSpreadsheet className="size-4" />
        {descargarExcel.isPending ? "Generando..." : "Excel"}
      </Button>
    </div>
  );
}
