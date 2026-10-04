import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { consultarAnexoSunat, descargarConsolidadoCriterios } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { TipoAnexoSunat } from "@/lib/types";
import { cn, descargarBlob } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const ANEXOS: { tipo: TipoAnexoSunat; etiqueta: string }[] = [
  { tipo: "correlaciones", etiqueta: "Correlaciones" },
  { tipo: "convenios", etiqueta: "Convenio internacional" },
  { tipo: "restricciones", etiqueta: "Restricciones" },
  { tipo: "descripciones", etiqueta: "Descripciones mínimas" },
];

const CLASE_BOTON =
  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Los enlaces que SUNAT pone al pie del detalle de una subpartida ("Otros
 * requisitos para la comercialización con otros países").
 *
 * Correlaciones, convenios, restricciones y descripciones mínimas se
 * muestran acá mismo: el portal solo las sirve dentro de la sesión de una
 * búsqueda (un link suelto cae en su página de error), así que las trae el
 * backend. El consolidado de criterios es un ZIP que SUNAT solo sirve por
 * HTTP -- también pasa por el backend para que el navegador no bloquee la
 * descarga. Las resoluciones de clasificación son otra aplicación de SUNAT
 * que sí abre bien con un link.
 */
export function OtrosRequisitosSunat({ codigo }: { codigo: string }) {
  const [abierto, setAbierto] = useState<TipoAnexoSunat | null>(null);
  const [descargando, setDescargando] = useState(false);
  const digitos = codigo.replace(/\./g, "");

  const anexo = useQuery({
    queryKey: queryKeys.arancel.anexoSunat(codigo, abierto ?? ""),
    queryFn: () => consultarAnexoSunat(codigo, abierto as TipoAnexoSunat),
    enabled: abierto !== null,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  async function descargarConsolidado() {
    setDescargando(true);
    try {
      descargarBlob(await descargarConsolidadoCriterios(), "consolidado-indice-criterios-sunat.zip");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo descargar el consolidado.");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4" aria-labelledby="titulo-otros-requisitos">
      <h3 id="titulo-otros-requisitos" className="text-sm font-semibold text-texto">
        Otros requisitos para la comercialización con otros países
      </h3>

      <div className="flex flex-wrap gap-2">
        {ANEXOS.map(({ tipo, etiqueta }) => {
          const activo = abierto === tipo;
          return (
            <button
              key={tipo}
              type="button"
              aria-pressed={activo}
              aria-controls="contenido-anexo-sunat"
              onClick={() => setAbierto(activo ? null : tipo)}
              className={cn(
                CLASE_BOTON,
                activo
                  ? "border-coral/50 bg-coral/15 text-coral"
                  : "border-border text-texto hover:bg-surface-border/50",
              )}
            >
              {etiqueta}
            </button>
          );
        })}
        <button
          type="button"
          onClick={descargarConsolidado}
          disabled={descargando}
          className={cn(CLASE_BOTON, "border-border text-texto hover:bg-surface-border/50 disabled:opacity-60")}
          title="Descarga el ZIP publicado por SUNAT"
        >
          {descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Consolidado de índice de criterios
        </button>
        <a
          href={`http://www.aduanet.gob.pe/ol-ad-caInter/regclasInterS01Alias?cmbCriterio=1&txtValor=${digitos}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(CLASE_BOTON, "border-border text-texto hover:bg-surface-border/50")}
          title="Se abre en el portal de SUNAT"
        >
          <ExternalLink className="size-4" />
          Resoluciones de clasificación
        </a>
      </div>

      {abierto !== null && (
        <div id="contenido-anexo-sunat" className="rounded-lg border border-border bg-bg p-4">
          {anexo.isLoading ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-[13px] text-texto-secundario">
                <Loader2 className="size-4 animate-spin" />
                Consultando SUNAT...
              </p>
              <Skeleton className="h-24 w-full" />
            </div>
          ) : anexo.isError ? (
            <p className="text-[13px] text-rojo">
              {anexo.error instanceof Error ? anexo.error.message : "No se pudo consultar SUNAT."}
            </p>
          ) : anexo.data ? (
            // HTML saneado en el backend con lista blanca (tablas, párrafos,
            // negritas; sin atributos, scripts, links ni imágenes): es la
            // barrera, no el escape de React.
            <div
              className={cn(
                "max-h-[50vh] overflow-auto text-[13px] leading-relaxed text-texto",
                "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
                "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
                "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
                "[&_b]:font-semibold [&_p]:m-0",
              )}
              dangerouslySetInnerHTML={{ __html: anexo.data.html }}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
