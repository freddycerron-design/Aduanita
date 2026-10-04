import { useEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";

import { consultarGravamenesSunat } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import type { LineaNomenclatura, SubpartidaArancelaria, UbicacionNomenclatura } from "@/lib/types";
import { OtrosRequisitosSunat } from "@/components/arancel/OtrosRequisitosSunat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export interface SunatGravamenesDialogProps {
  /** `null` = cerrado. */
  partida: SubpartidaArancelaria | null;
  onClose: () => void;
}

/** SUNAT escribe los títulos de sección en mayúsculas sostenidas; en tipo
 * oración se leen mucho mejor. Los de capítulo ya vienen bien. */
function tipoOracion(texto: string): string {
  if (texto !== texto.toUpperCase()) return texto;
  const minusculas = texto.toLowerCase();
  return minusculas.charAt(0).toUpperCase() + minusculas.slice(1);
}

/**
 * Ficha de una subpartida consultada en vivo en SUNAT (el backend replica
 * la consulta del portal, que no se puede abrir con un link directo):
 * dónde está en la nomenclatura -- sección, capítulo y las partidas
 * vecinas con todos sus niveles, como el listado del portal -- y sus
 * gravámenes vigentes. Desde el listado se puede saltar a otra subpartida
 * nacional sin cerrar la ficha, igual que en SUNAT. Quien lo monta le
 * pone `key={partida.codigo}`, así cada subpartida de la grilla arranca
 * desde su propia ficha y no desde la última navegada.
 */
export function SunatGravamenesDialog({ partida, onClose }: SunatGravamenesDialogProps) {
  const [codigoNavegado, setCodigoNavegado] = useState<string | null>(null);
  const codigoOriginal = partida?.codigo ?? "";
  const codigo = codigoNavegado ?? codigoOriginal;
  const enOriginal = codigo === codigoOriginal;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.arancel.sunat(codigo),
    queryFn: () => consultarGravamenesSunat(codigo),
    enabled: codigo !== "",
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const adValoremSunat = data?.gravamenes.find((g) => g.concepto === "Ad Valorem")?.valor;
  // El ad valorem local solo es comparable con la subpartida de la grilla.
  const adValoremLocal = enOriginal && partida && partida.ad_valorem !== null ? `${partida.ad_valorem}%` : null;
  const difiere = adValoremSunat !== undefined && adValoremLocal !== null && adValoremSunat !== adValoremLocal;

  return (
    <Dialog open={partida !== null} onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 pr-8">
            <span className="font-mono text-xl tracking-tight">{codigo}</span>
            {!enOriginal && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setCodigoNavegado(null)}>
                <ArrowLeft />
                Volver a {codigoOriginal}
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>Consultado en este momento en el portal de aranceles de SUNAT.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-sm text-texto-secundario">
                <Loader2 className="size-4 animate-spin" />
                Consultando SUNAT...
              </p>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : isError ? (
            <p className="rounded-xl border border-rojo/40 bg-rojo/10 px-4 py-3 text-sm text-rojo">
              {error instanceof Error ? error.message : "No se pudo consultar SUNAT."} Puedes intentar de nuevo
              más tarde o consultarla directamente en el portal.
            </p>
          ) : data ? (
            <div className="flex flex-col gap-5">
              {data.ubicacion && <Encabezados ubicacion={data.ubicacion} />}

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
                {data.ubicacion ? (
                  <Nomenclatura lineas={data.ubicacion.lineas} onConsultar={setCodigoNavegado} />
                ) : (
                  <p className="text-[13px] text-texto-secundario">
                    SUNAT no devolvió la ubicación de la subpartida en la nomenclatura.
                  </p>
                )}

                <section className="flex flex-col gap-3" aria-labelledby="titulo-gravamenes">
                  <h3 id="titulo-gravamenes" className="text-sm font-semibold text-texto">
                    Gravámenes vigentes
                  </h3>
                  {data.tipo_producto && (
                    <p className="text-[13px] text-texto-secundario">
                      Tipo de producto: <span className="text-texto">{data.tipo_producto}</span>
                    </p>
                  )}
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableBody>
                        {data.gravamenes.map((g) => (
                          <TableRow key={g.concepto}>
                            <TableCell className="py-2 text-[13px]">{g.concepto}</TableCell>
                            <TableCell className="whitespace-nowrap py-2 text-right text-sm font-medium tabular-nums">
                              {g.valor}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {difiere && (
                    <p className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[13px] text-amber">
                      El ad valorem vigente ({adValoremSunat}) es distinto al del arancel 2022 cargado en Aduafy (
                      {adValoremLocal}). Usa el de SUNAT.
                    </p>
                  )}
                  {data.gravamenes.some((g) => g.concepto === "Derecho antidumping" && g.valor === "Aplica") && (
                    <p className="text-[13px] text-texto-secundario">
                      El derecho antidumping depende del país de origen; revisa el detalle en SUNAT.
                    </p>
                  )}
                </section>
              </div>

              {/* key: al saltar a otra subpartida se cierra el anexo abierto. */}
              <OtrosRequisitosSunat key={codigo} codigo={codigo} />
            </div>
          ) : null}
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <a
            href={data?.url_consulta ?? "http://www.aduanet.gob.pe/itarancel/arancelS01Alias"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-coral hover:underline"
          >
            <ExternalLink className="size-4" />
            Abrir el portal de SUNAT (buscar {codigo.replace(/\./g, "")})
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Encabezados({ ubicacion }: { ubicacion: UbicacionNomenclatura }) {
  const filas = [
    ubicacion.seccion && { rotulo: `Sección ${ubicacion.seccion.numero}`, titulo: ubicacion.seccion.titulo },
    ubicacion.capitulo && { rotulo: `Capítulo ${ubicacion.capitulo.numero}`, titulo: ubicacion.capitulo.titulo },
  ].filter((fila): fila is { rotulo: string; titulo: string } => Boolean(fila));

  if (filas.length === 0) return null;

  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-bg px-4 py-3">
      {filas.map((fila) => (
        <div key={fila.rotulo} className="contents">
          <dt className="text-sm font-semibold text-texto">{fila.rotulo}</dt>
          <dd className="text-sm leading-relaxed text-texto">{tipoOracion(fila.titulo)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Listado de la nomenclatura alrededor de la subpartida, con la sangría
 * por guiones que usa el arancel (cada guion es un nivel: "- Los demás"
 * cuelga del texto con un guion menos que tiene encima). La fila
 * consultada se resalta y se centra en pantalla al cargar.
 */
function Nomenclatura({
  lineas,
  onConsultar,
}: {
  lineas: LineaNomenclatura[];
  onConsultar: (codigo: string) => void;
}) {
  const filaActualRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    filaActualRef.current?.scrollIntoView({ block: "center" });
  }, [lineas]);

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="titulo-nomenclatura">
      <h3 id="titulo-nomenclatura" className="text-sm font-semibold text-texto">
        Ubicación en el arancel
      </h3>
      <ol className="max-h-[42vh] overflow-y-auto rounded-lg border border-border py-1">
        {lineas.map((linea, indice) => (
          <FilaNomenclatura
            key={`${linea.codigo ?? "texto"}-${indice}`}
            linea={linea}
            onConsultar={onConsultar}
            filaRef={linea.es_actual ? filaActualRef : undefined}
          />
        ))}
      </ol>
      <p className="text-[13px] text-texto-secundario">
        Elige otra subpartida de 10 dígitos para ver su ficha.
      </p>
    </section>
  );
}

function FilaNomenclatura({
  linea,
  onConsultar,
  filaRef,
}: {
  linea: LineaNomenclatura;
  onConsultar: (codigo: string) => void;
  filaRef?: Ref<HTMLLIElement>;
}) {
  const esPartida = linea.nivel === 0 && linea.codigo !== null;
  const navegable = linea.es_subpartida_nacional && !linea.es_actual && linea.codigo !== null;

  return (
    <li
      ref={filaRef}
      aria-current={linea.es_actual ? "true" : undefined}
      className={cn(
        "grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-l-2 border-transparent px-3 py-1.5 text-sm",
        esPartida && "mt-2 first:mt-0",
        linea.es_actual && "border-coral bg-coral/10",
      )}
    >
      <span className="font-mono text-[13px] tabular-nums">
        {navegable ? (
          <button
            type="button"
            onClick={() => onConsultar(linea.codigo as string)}
            className="rounded text-coral hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Ver la ficha de ${linea.codigo}`}
          >
            {linea.codigo}
          </button>
        ) : (
          <span className={cn(linea.es_actual ? "font-semibold text-coral" : "text-texto-secundario", esPartida && "font-semibold text-texto")}>
            {linea.codigo ?? ""}
          </span>
        )}
      </span>
      <span
        className={cn(
          "leading-snug",
          esPartida ? "font-semibold text-texto" : "text-texto",
          linea.es_actual && "font-medium",
        )}
      >
        {linea.nivel > 0 && (
          <span className="mr-1.5 select-none text-texto-secundario" aria-hidden="true">
            {"– ".repeat(linea.nivel).trim()}
          </span>
        )}
        {linea.descripcion}
      </span>
    </li>
  );
}
