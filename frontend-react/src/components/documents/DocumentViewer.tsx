import { useState } from "react";
import { FileJson, FileText } from "lucide-react";

import { TIPOS_DOCUMENTO } from "@/lib/types";
import type { DocumentoExtraidoOut, TipoDocumento } from "@/lib/types";
import { useSignedPdfUrl } from "@/hooks/useSignedPdfUrl";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type ModoVisor = "JSON" | "PDF";

export interface DocumentViewerProps {
  documentos: DocumentoExtraidoOut[];
}

/**
 * Selector de tipo de documento + toggle JSON/PDF. La URL firmada del PDF
 * se pide de forma perezosa -- solo cuando el usuario esta en modo "PDF",
 * via `useSignedPdfUrl` -- para no gastar llamadas a Storage mientras esta
 * mirando el JSON.
 */
export function DocumentViewer({ documentos }: DocumentViewerProps) {
  const disponibles = TIPOS_DOCUMENTO.filter((tipo) => documentos.some((d) => d.tipo_documento === tipo));
  const [tipoSeleccionado, setTipoSeleccionado] = useState<TipoDocumento | undefined>(undefined);
  const [modo, setModo] = useState<ModoVisor>("JSON");

  // Si el tipo elegido ya no esta disponible (p.ej. se elimino), cae al
  // primero disponible sin necesidad de un efecto.
  const tipoActivo = tipoSeleccionado && disponibles.includes(tipoSeleccionado) ? tipoSeleccionado : disponibles[0];
  const documento = documentos.find((d) => d.tipo_documento === tipoActivo);

  const signedUrl = useSignedPdfUrl(documento?.url_pdf_storage ?? "", modo === "PDF" && !!documento);

  if (!documento || !tipoActivo) {
    return <p className="text-sm text-texto-secundario">Aún no se ha cargado ningún documento.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={tipoActivo} onValueChange={(valor) => setTipoSeleccionado(valor as TipoDocumento)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {disponibles.map((tipo) => (
              <SelectItem key={tipo} value={tipo}>
                {tipo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={modo === "JSON" ? "primary" : "outline"}
            onClick={() => setModo("JSON")}
          >
            <FileJson />
            JSON
          </Button>
          <Button
            type="button"
            size="sm"
            variant={modo === "PDF" ? "primary" : "outline"}
            onClick={() => setModo("PDF")}
          >
            <FileText />
            PDF
          </Button>
        </div>
      </div>

      {modo === "JSON" ? (
        documento.procesado ? (
          <div className="flex flex-col gap-2">
            {documento.metodo_extraccion && (
              <p className="text-xs text-texto-secundario">
                Método de extracción:{" "}
                {documento.metodo_extraccion === "GEMINI_VISION"
                  ? "OCR/Visión (PDF escaneado)"
                  : "Texto digital"}
              </p>
            )}
            <pre className="max-h-[480px] overflow-auto rounded-xl border border-border bg-surface p-4 text-xs text-texto">
              {JSON.stringify(documento.contenido_json, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
            Pendiente de procesar. Presiona &quot;Procesar información&quot; para extraer sus datos.
          </p>
        )
      ) : signedUrl.isLoading ? (
        <Skeleton className="h-[480px] w-full" />
      ) : signedUrl.isError ? (
        <p className="rounded-xl border border-rojo/40 bg-rojo/10 p-4 text-sm text-rojo">
          No se pudo generar la vista previa del PDF
          {signedUrl.error instanceof Error ? `: ${signedUrl.error.message}` : "."}
        </p>
      ) : signedUrl.data ? (
        <iframe
          src={signedUrl.data}
          className="w-full h-[480px] rounded-xl border border-border"
          title={`PDF ${tipoActivo}`}
        />
      ) : null}
    </div>
  );
}
