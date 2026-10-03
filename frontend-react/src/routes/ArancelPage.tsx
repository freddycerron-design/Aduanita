import { useState } from "react";
import type { FormEvent } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";

import { useBuscarArancel } from "@/hooks/useBuscarArancel";
import type { SubpartidaArancelaria } from "@/lib/types";
import { SunatGravamenesDialog } from "@/components/arancel/SunatGravamenesDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Consulta libre del Arancel Nacional. Las mismas ~8,000 subpartidas que
 * el clasificador ya usa como contexto interno, ahora buscables a mano.
 * El backend decide el modo de búsqueda según lo que se escriba (código
 * por prefijo vs. texto full-text), así que acá solo hay una caja.
 */
export function ArancelPage() {
  const [entrada, setEntrada] = useState("");
  const [consulta, setConsulta] = useState("");
  const [partidaSunat, setPartidaSunat] = useState<SubpartidaArancelaria | null>(null);
  const { data: resultados, isFetching, isError, error } = useBuscarArancel(consulta);

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setConsulta(entrada);
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-texto">Consulta de aranceles</h1>
          <p className="mt-1 text-sm text-texto-secundario">
            Busca por código de subpartida (ej. <span className="font-mono">9011</span> o{" "}
            <span className="font-mono">6305.33</span>) o por descripción de la mercancía (ej.{" "}
            <span className="italic">sacos de polipropileno</span>).
          </p>
        </div>

        <form onSubmit={buscar} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-secundario" />
            <Input
              value={entrada}
              onChange={(evento) => setEntrada(evento.target.value)}
              placeholder="Código o descripción"
              aria-label="Código o descripción a buscar en el arancel"
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={isFetching || entrada.trim() === ""}>
            {isFetching && <Loader2 className="animate-spin" />}
            Buscar
          </Button>
        </form>

        {isError ? (
          <p className="text-sm text-rojo">
            No se pudo consultar el arancel{error instanceof Error ? `: ${error.message}` : "."}
          </p>
        ) : consulta === "" ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
            Escribe un código o una descripción para empezar.
          </p>
        ) : resultados && resultados.length === 0 && !isFetching ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
            Sin resultados para &quot;{consulta}&quot;.
          </p>
        ) : resultados && resultados.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subpartida</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Ad valorem</TableHead>
                  <TableHead>
                    <span className="sr-only">Consultar en SUNAT</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((partida) => (
                  <TableRow key={partida.codigo}>
                    <TableCell className="whitespace-nowrap font-mono text-sm font-semibold tracking-tight">
                      {partida.codigo}
                    </TableCell>
                    <TableCell className="max-w-prose text-[15px] leading-relaxed">{partida.descripcion}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-[15px] font-medium tabular-nums">
                      {partida.ad_valorem === null ? "—" : `${partida.ad_valorem}%`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setPartidaSunat(partida)}
                        className="inline-flex items-center gap-1 rounded text-sm font-medium text-coral hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title="Ver los gravámenes vigentes en SUNAT"
                      >
                        <ExternalLink className="size-4" />
                        SUNAT
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-xs leading-relaxed text-amber">
          Arancel de Aduanas del Perú 2022 (D.S. 404-2021-EF). La nomenclatura y las descripciones son
          las oficiales de ese documento; el ad valorem puede haber cambiado por decretos posteriores,
          así que tómalo como referencia y no como la tasa vigente garantizada. Usa el link SUNAT de cada
          subpartida para ver los gravámenes vigentes.
        </p>
      </div>

      <SunatGravamenesDialog partida={partidaSunat} onClose={() => setPartidaSunat(null)} />
    </div>
  );
}
