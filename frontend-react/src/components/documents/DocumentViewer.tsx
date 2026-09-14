import { useState } from "react";
import { FileJson, Image as ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { TIPOS_DOCUMENTO } from "@/lib/types";
import type { DocumentoExtraidoOut, TipoDocumento } from "@/lib/types";
import { useSignedPdfUrl } from "@/hooks/useSignedPdfUrl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type ModoVisor = "JSON" | "ORIGINAL";

export interface DocumentViewerProps {
  documentos: DocumentoExtraidoOut[];
}

const MAX_SELECCION = 2;

/**
 * Selector de documentos (hasta 2 a la vez, con FIFO -- elegir un tercero
 * reemplaza al mas antiguo) + comparacion lado a lado. Con 1 seleccionado
 * se ve una sola ventana a ancho completo; con 2, dos ventanas una al
 * costado de la otra para que el usuario compare visualmente (cada una
 * con su propio toggle JSON/PDF independiente -- se puede comparar PDF
 * contra PDF, JSON contra JSON, o cruzado).
 */
export function DocumentViewer({ documentos }: DocumentViewerProps) {
  const disponibles = TIPOS_DOCUMENTO.filter((tipo) => documentos.some((d) => d.tipo_documento === tipo));
  const [seleccionados, setSeleccionados] = useState<TipoDocumento[]>([]);

  // Si nada esta explicitamente seleccionado (primera carga, o el/los
  // tipos elegidos ya no estan disponibles porque se eliminaron), cae al
  // primer documento disponible -- mismo espiritu de fallback que tenia
  // el <Select> original, sin necesidad de un efecto.
  const seleccionValida = seleccionados.filter((tipo) => disponibles.includes(tipo));
  const tiposAVer = seleccionValida.length > 0 ? seleccionValida : disponibles.slice(0, 1);

  function alternarSeleccion(tipo: TipoDocumento) {
    // Parte de lo que se esta viendo AHORA (incluye el fallback implicito
    // de arriba), no del estado crudo -- asi el primer click sobre un
    // segundo tipo lo agrega al que ya se ve por defecto, en vez de
    // reemplazarlo.
    if (tiposAVer.includes(tipo)) {
      setSeleccionados(tiposAVer.filter((t) => t !== tipo));
    } else if (tiposAVer.length >= MAX_SELECCION) {
      setSeleccionados([...tiposAVer.slice(1), tipo]); // bota el mas antiguo
    } else {
      setSeleccionados([...tiposAVer, tipo]);
    }
  }

  if (disponibles.length === 0) {
    return <p className="text-sm text-texto-secundario">Aún no se ha cargado ningún documento.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {disponibles.map((tipo) => {
          const activo = tiposAVer.includes(tipo);
          return (
            <button
              key={tipo}
              type="button"
              onClick={() => alternarSeleccion(tipo)}
              aria-pressed={activo}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                activo
                  ? "border-coral bg-coral/15 text-coral"
                  : "border-border bg-surface text-texto-secundario hover:text-texto",
              )}
            >
              {tipo}
            </button>
          );
        })}
        <span className="text-xs text-texto-secundario">
          Elige hasta {MAX_SELECCION} para comparar ({tiposAVer.length}/{MAX_SELECCION})
        </span>
      </div>

      <div className={cn("grid gap-3", tiposAVer.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1")}>
        {tiposAVer.map((tipo) => {
          const documento = documentos.find((d) => d.tipo_documento === tipo);
          return documento ? <DocumentPane key={tipo} tipo={tipo} documento={documento} /> : null;
        })}
      </div>
    </div>
  );
}

/** Una ventana individual del visor: encabezado con el tipo + toggle
 * JSON/original propio, y el contenido segun el modo elegido. El
 * "original" puede ser un PDF o una foto (JPG/PNG/WEBP) -- se distingue
 * por la extension del path guardado para elegir entre <iframe> (PDF) e
 * <img> (imagen) al mostrarlo. */
function DocumentPane({ tipo, documento }: { tipo: TipoDocumento; documento: DocumentoExtraidoOut }) {
  const [modo, setModo] = useState<ModoVisor>("JSON");
  const signedUrl = useSignedPdfUrl(documento.url_pdf_storage, modo === "ORIGINAL");
  const esImagen = /\.(jpg|jpeg|png|webp)$/i.test(documento.url_pdf_storage);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-texto-secundario">
          {tipo}
        </span>
        <div className="flex shrink-0 gap-1">
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
            variant={modo === "ORIGINAL" ? "primary" : "outline"}
            onClick={() => setModo("ORIGINAL")}
          >
            <ImageIcon />
            Original
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
          No se pudo generar la vista previa del documento
          {signedUrl.error instanceof Error ? `: ${signedUrl.error.message}` : "."}
        </p>
      ) : signedUrl.data ? (
        esImagen ? (
          <img
            src={signedUrl.data}
            className="h-[480px] w-full rounded-xl border border-border object-contain bg-surface"
            alt={`Documento original: ${tipo}`}
          />
        ) : (
          <iframe
            src={signedUrl.data}
            className="h-[480px] w-full rounded-xl border border-border"
            title={`Documento original: ${tipo}`}
          />
        )
      ) : null}
    </div>
  );
}
