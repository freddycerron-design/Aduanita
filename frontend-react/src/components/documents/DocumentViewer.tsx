import { useState } from "react";
import { FileJson, Image as ImageIcon, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { puedeCorregirDatosExtraidos } from "@/lib/roles";
import { TIPOS_DOCUMENTO } from "@/lib/types";
import type {
  DocumentoExtraidoOut,
  EstadoDespacho,
  NivelConfianza,
  TipoDocumento,
} from "@/lib/types";
import { useProfile } from "@/hooks/useProfile";
import { useSignedPdfUrl } from "@/hooks/useSignedPdfUrl";
import { useActualizarContenidoDocumento } from "@/hooks/useActualizarContenidoDocumento";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentContentForm } from "@/components/documents/DocumentContentForm";

type ModoVisor = "JSON" | "ORIGINAL";

export interface DocumentViewerProps {
  idDespacho: string;
  estadoDespacho: EstadoDespacho;
  documentos: DocumentoExtraidoOut[];
}

const MAX_SELECCION = 2;

/** Cuanto confia el modelo en su propia lectura. El nivel lo deriva el
 * backend desde el score numerico (services/pdf_processor.py), acá solo
 * se le pone color y palabras. */
const CONFIANZA_INFO: Record<NivelConfianza, { label: string; variante: "verde" | "amber" | "rojo" }> = {
  ALTA: { label: "Lectura confiable", variante: "verde" },
  MEDIA: { label: "Revisar datos", variante: "amber" },
  BAJA: { label: "Lectura dudosa", variante: "rojo" },
};

/**
 * Selector de documentos (hasta 2 a la vez, con FIFO -- elegir un tercero
 * reemplaza al mas antiguo) + comparacion lado a lado. Con 1 seleccionado
 * se ve una sola ventana a ancho completo; con 2, dos ventanas una al
 * costado de la otra para que el usuario compare visualmente (cada una
 * con su propio toggle JSON/PDF independiente -- se puede comparar PDF
 * contra PDF, JSON contra JSON, o cruzado).
 */
export function DocumentViewer({ idDespacho, estadoDespacho, documentos }: DocumentViewerProps) {
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
          return documento ? (
            <DocumentPane
              key={tipo}
              tipo={tipo}
              documento={documento}
              idDespacho={idDespacho}
              estadoDespacho={estadoDespacho}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

/** Una ventana individual del visor: encabezado con el tipo + toggle
 * JSON/original propio, y el contenido segun el modo elegido. El
 * "original" puede ser un PDF o una foto (JPG/PNG/WEBP/HEIC) -- se
 * distingue por la extension del path guardado para elegir entre
 * <iframe> (PDF) e <img> (imagen) al mostrarlo.
 *
 * El panel de datos no se desmonta al cambiar a "Original": asi se puede
 * mirar el documento escaneado a mitad de una correccion y volver sin
 * perder lo tipeado. */
function DocumentPane({
  tipo,
  documento,
  idDespacho,
  estadoDespacho,
}: {
  tipo: TipoDocumento;
  documento: DocumentoExtraidoOut;
  idDespacho: string;
  estadoDespacho: EstadoDespacho;
}) {
  const [modo, setModo] = useState<ModoVisor>("JSON");
  const [editando, setEditando] = useState(false);
  const { data: perfil } = useProfile();
  const actualizar = useActualizarContenidoDocumento(idDespacho);
  const signedUrl = useSignedPdfUrl(documento.url_pdf_storage, modo === "ORIGINAL");
  const esImagen = /\.(jpg|jpeg|png|webp|heic)$/i.test(documento.url_pdf_storage);

  // Espejo del gate del backend: GESTOR (o ADMIN), documento ya extraido,
  // y el despacho todavia abierto -- un FINALIZADO ya tiene su decision
  // registrada y sus hallazgos son el registro de lo que se reviso.
  const puedeEditar =
    puedeCorregirDatosExtraidos(perfil?.rol) && documento.procesado && estadoDespacho !== "FINALIZADO";

  const confianza = documento.nivel_confianza ? CONFIANZA_INFO[documento.nivel_confianza] : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-texto-secundario">
            {tipo}
          </span>
          {documento.editado_en ? (
            // La revision de una persona pesa mas que el score de la
            // maquina, asi que reemplaza al badge de confianza.
            <Badge variant="indigo">Corregido a mano</Badge>
          ) : (
            confianza && (
              <Badge
                variant={confianza.variante}
                title={`El modelo calificó su propia lectura con ${Math.round(
                  (documento.confianza_extraccion ?? 0) * 100,
                )}% de confianza`}
              >
                {confianza.label}
              </Badge>
            )
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant={modo === "JSON" ? "primary" : "outline"}
            onClick={() => setModo("JSON")}
          >
            <FileJson />
            Datos
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

      {/* El wrapper que oculta y el que maqueta son dos elementos distintos
          a proposito: `hidden` y `flex` pelean por la misma propiedad
          `display`, y cual gana dependeria del orden en que Tailwind emita
          sus utilidades, no del orden de las clases. */}
      <div className={cn(modo !== "JSON" && "hidden")}>
        <div className="flex flex-col gap-2">
          {documento.procesado ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {documento.metodo_extraccion && (
                  <p className="text-xs text-texto-secundario">
                    Método de extracción:{" "}
                    {documento.metodo_extraccion === "GEMINI_VISION"
                      ? "OCR/Visión (PDF escaneado)"
                      : "Texto digital"}
                  </p>
                )}
                {puedeEditar && !editando && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditando(true)}>
                    <Pencil />
                    Corregir datos
                  </Button>
                )}
              </div>

              {documento.campos_inciertos.length > 0 && !editando && (
                <p className="rounded-lg border border-amber/40 bg-amber/10 p-3 text-xs text-amber">
                  El modelo no leyó con seguridad:{" "}
                  {documento.campos_inciertos.map((campo) => campo.replace(/_/g, " ")).join(", ")}.
                  Compáralos con el original antes de continuar.
                </p>
              )}

              {editando ? (
                <DocumentContentForm
                  contenido={documento.contenido_json}
                  camposInciertos={documento.campos_inciertos}
                  columnasPorLista={documento.columnas_por_lista}
                  guardando={actualizar.isPending}
                  onCancelar={() => setEditando(false)}
                  onGuardar={(contenidoJson) =>
                    actualizar.mutate(
                      { tipoDocumento: tipo, contenidoJson },
                      { onSuccess: () => setEditando(false) },
                    )
                  }
                />
              ) : (
                <pre className="max-h-[480px] overflow-auto rounded-xl border border-border bg-surface p-4 text-xs text-texto">
                  {JSON.stringify(documento.contenido_json, null, 2)}
                </pre>
              )}
            </>
          ) : (
            <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
              Pendiente de procesar. Presiona &quot;Procesar información&quot; para extraer sus datos.
            </p>
          )}
        </div>
      </div>

      {modo === "ORIGINAL" &&
        (signedUrl.isLoading ? (
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
        ) : null)}
    </div>
  );
}
