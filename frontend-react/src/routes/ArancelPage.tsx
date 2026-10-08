import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";

import { useBuscarArancel } from "@/hooks/useBuscarArancel";
import { useChatClasificador } from "@/hooks/useChatClasificador";
import { ChatClasificador } from "@/components/clasificador/ChatClasificador";
import { useAlternarFavorito, usePartidasFavoritas } from "@/hooks/usePartidasFavoritas";
import { raicesDeConsulta, resaltar } from "@/lib/resaltar";
import type { SubpartidaArancelaria } from "@/lib/types";
import { SunatGravamenesDialog } from "@/components/arancel/SunatGravamenesDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ES_CODIGO = /^[\d.]+$/;

/** Copia el código tal como se muestra (con puntos). El ícono pasa a un
 * check un momento para confirmar la copia. */
function CopiarCodigo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const id = window.setTimeout(() => setCopiado(false), 1500);
    return () => window.clearTimeout(id);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      toast.error("No se pudo copiar el código.");
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={`Copiar ${codigo}`}
      title={copiado ? "Copiado" : "Copiar código"}
      className="rounded p-1 text-texto-secundario transition-colors hover:bg-surface-border hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copiado ? <Check className="size-4 text-verde" /> : <Copy className="size-4" />}
    </button>
  );
}

interface TablaPartidasProps {
  partidas: SubpartidaArancelaria[];
  favoritos: Set<string>;
  onAlternarFavorito: (partida: SubpartidaArancelaria, marcar: boolean) => void;
  onVerSunat: (partida: SubpartidaArancelaria) => void;
  /** Raíces de la búsqueda por texto a resaltar en la descripción. */
  raices?: string[];
  /** En la pestaña Favoritos: botón explícito para quitar. */
  onQuitar?: (partida: SubpartidaArancelaria) => void;
}

function TablaPartidas({ partidas, favoritos, onAlternarFavorito, onVerSunat, raices = [], onQuitar }: TablaPartidasProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Favorito</span>
            </TableHead>
            <TableHead>Subpartida</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead className="text-right">Ad valorem</TableHead>
            <TableHead>
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {partidas.map((partida) => {
            const esFavorita = favoritos.has(partida.codigo);
            return (
              <TableRow key={partida.codigo}>
                <TableCell className="pr-0">
                  <button
                    type="button"
                    onClick={() => onAlternarFavorito(partida, !esFavorita)}
                    aria-pressed={esFavorita}
                    aria-label={esFavorita ? `Quitar ${partida.codigo} de favoritos` : `Agregar ${partida.codigo} a favoritos`}
                    title={esFavorita ? "Quitar de favoritos" : "Agregar a favoritos"}
                    className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Star
                      className={
                        esFavorita
                          ? "size-5 fill-amber text-amber"
                          : "size-5 text-texto-secundario transition-colors hover:text-amber"
                      }
                    />
                  </button>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-base font-semibold tracking-tight">{partida.codigo}</span>
                    <CopiarCodigo codigo={partida.codigo} />
                  </div>
                </TableCell>
                <TableCell className="max-w-prose text-[15px] leading-relaxed">
                  {resaltar(partida.descripcion, raices)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-[15px] font-medium tabular-nums">
                  {partida.ad_valorem === null ? "—" : `${partida.ad_valorem}%`}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onVerSunat(partida)}
                      className="inline-flex items-center gap-1 rounded text-sm font-medium text-coral hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Ver ubicación en el arancel y gravámenes vigentes en SUNAT"
                    >
                      <ExternalLink className="size-4" />
                      SUNAT
                    </button>
                    {onQuitar && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onQuitar(partida)}
                        aria-label={`Quitar ${partida.codigo} de favoritos`}
                        title="Quitar de favoritos"
                        className="text-rojo hover:bg-rojo/10 hover:text-rojo"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

type PestanaArancel = "ia" | "buscar" | "favoritos";

/**
 * Consulta libre del Arancel Nacional + subpartidas favoritas del usuario.
 * El backend decide el modo de búsqueda según lo que se escriba (código
 * por prefijo vs. texto full-text); en la búsqueda por texto se resaltan
 * en la descripción las palabras buscadas. La pestaña activa vive en
 * `?tab=` como en el resto de la app.
 */
export function ArancelPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const pestana: PestanaArancel = tabParam === "favoritos" || tabParam === "ia" ? tabParam : "buscar";
  // El chat vive acá y no en su pestaña: Radix desmonta la pestaña
  // inactiva y se perdería la conversación al ir a Buscar y volver.
  const chat = useChatClasificador();
  // La búsqueda vive en `?q=`: así otra pantalla puede abrir esta ya
  // buscando (ej. "Buscar en aranceles" desde la preclasificación) y el
  // botón atrás vuelve al resultado anterior.
  const consulta = searchParams.get("q") ?? "";
  // `?volver=` lo pone quien abre esta pantalla para buscar algo puntual
  // (ej. "Buscar en aranceles" desde la preclasificación). Solo se acepta
  // una ruta interna de un despacho: nunca una URL arbitraria.
  const volverParam = searchParams.get("volver");
  const volver = volverParam && volverParam.startsWith("/despachos/") ? volverParam : null;
  const [entrada, setEntrada] = useState(consulta);
  const [partidaSunat, setPartidaSunat] = useState<SubpartidaArancelaria | null>(null);
  const { data: resultados, isFetching, isError, error } = useBuscarArancel(consulta);
  const { data: favoritas, isLoading: favoritasCargando, isError: favoritasError } = usePartidasFavoritas();
  const alternar = useAlternarFavorito();

  const codigosFavoritos = useMemo(() => new Set((favoritas ?? []).map((p) => p.codigo)), [favoritas]);
  const raices = useMemo(
    () => (ES_CODIGO.test(consulta.trim()) ? [] : raicesDeConsulta(consulta)),
    [consulta],
  );

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSearchParams((prev) => {
      const siguiente = new URLSearchParams(prev);
      siguiente.set("q", entrada.trim());
      siguiente.delete("tab");
      return siguiente;
    });
  }

  function alternarFavorito(partida: SubpartidaArancelaria, marcar: boolean) {
    alternar.mutate({ partida, marcar });
  }

  function irAPestana(valor: string) {
    setSearchParams((prev) => {
      const siguiente = new URLSearchParams(prev);
      siguiente.set("tab", valor);
      return siguiente;
    });
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          {volver && (
            <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
              <Link to={volver}>
                <ArrowLeft />
                Volver a la preclasificación
              </Link>
            </Button>
          )}
          <h1 className="text-xl font-semibold text-texto">Clasificador</h1>
          <p className="mt-1 text-sm text-texto-secundario">
            Clasifica una mercancía conversando con la IA, o busca directamente en el Arancel de Aduanas.
          </p>
        </div>

        <Tabs value={pestana} onValueChange={irAPestana}>
          <TabsList>
            <TabsTrigger value="ia">Clasificador con IA</TabsTrigger>
            <TabsTrigger value="buscar">Buscar en el arancel</TabsTrigger>
            <TabsTrigger value="favoritos">
              Favoritos{favoritas && favoritas.length > 0 ? ` (${favoritas.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ia">
            <ChatClasificador chat={chat} onVerFicha={setPartidaSunat} />
          </TabsContent>

          <TabsContent value="buscar" className="flex flex-col gap-6">
            <p className="text-[13px] text-texto-secundario">
              Busca por código de subpartida (ej. <span className="font-mono">9011</span> o{" "}
              <span className="font-mono">6305.33</span>) o por descripción de la mercancía (ej.{" "}
              <span className="italic">sacos de polipropileno</span>). Marca con la estrella las que uses seguido.
            </p>
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
              <TablaPartidas
                partidas={resultados}
                favoritos={codigosFavoritos}
                onAlternarFavorito={alternarFavorito}
                onVerSunat={setPartidaSunat}
                raices={raices}
              />
            ) : null}
          </TabsContent>

          <TabsContent value="favoritos">
            {favoritasCargando ? (
              <Skeleton className="h-48 w-full" />
            ) : favoritasError ? (
              <p className="text-sm text-rojo">No se pudieron cargar tus favoritos.</p>
            ) : !favoritas || favoritas.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
                Todavía no tienes favoritos. En la pestaña Buscar, marca la estrella de una subpartida para
                guardarla aquí.
              </p>
            ) : (
              <TablaPartidas
                partidas={favoritas}
                favoritos={codigosFavoritos}
                onAlternarFavorito={alternarFavorito}
                onVerSunat={setPartidaSunat}
                onQuitar={(partida) => alternarFavorito(partida, false)}
              />
            )}
          </TabsContent>
        </Tabs>

        <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-xs leading-relaxed text-amber">
          Arancel de Aduanas del Perú 2022 (D.S. 404-2021-EF). La nomenclatura y las descripciones son
          las oficiales de ese documento; el ad valorem puede haber cambiado por decretos posteriores,
          así que tómalo como referencia y no como la tasa vigente garantizada. Usa el link SUNAT de cada
          subpartida para ver los gravámenes vigentes.
        </p>
      </div>

      <SunatGravamenesDialog key={partidaSunat?.codigo ?? ""} partida={partidaSunat} onClose={() => setPartidaSunat(null)} />
    </div>
  );
}
