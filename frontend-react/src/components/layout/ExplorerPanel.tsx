import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ESTADO_INFO, ORDEN_ESTADOS } from "@/lib/estado";
import { useDespachos } from "@/hooks/useDespachos";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { NuevoDespachoDialog } from "@/components/layout/NuevoDespachoDialog";

interface ExplorerPanelProps {
  idDespachoActivo: string | undefined;
}

/**
 * Panel "Explorer": crear despacho, buscar por numero (client-side, sobre
 * la misma query cacheada de `useDespachos`) y navegar entre los despachos
 * existentes agrupados por estado -- mismo agrupado y orden que tenia el
 * sidebar del dashboard de Streamlit.
 */
export function ExplorerPanel({ idDespachoActivo }: ExplorerPanelProps) {
  const [busqueda, setBusqueda] = useState("");
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const navigate = useNavigate();
  const { data: despachos, isLoading } = useDespachos();

  const despachosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return (despachos ?? []).filter((d) => d.numero_despacho.toLowerCase().includes(termino));
  }, [despachos, busqueda]);

  const grupos = useMemo(
    () =>
      ORDEN_ESTADOS.map((estado) => ({
        estado,
        despachos: despachosFiltrados.filter((d) => d.estado === estado),
      })),
    [despachosFiltrados],
  );

  // Un grupo arranca expandido si tiene despachos (tras el filtro de
  // busqueda) o si contiene al despacho activo -- mismo criterio que
  // `expanded=bool(grupo) or grupo_activo` en el dashboard de Streamlit.
  const valoresAbiertos = useMemo(
    () =>
      grupos
        .filter((grupo) => grupo.despachos.length > 0 || grupo.despachos.some((d) => d.id === idDespachoActivo))
        .map((grupo) => grupo.estado),
    [grupos, idDespachoActivo],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border p-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-texto-secundario">Explorador</h2>
        <Button size="sm" className="w-full" onClick={() => setDialogoAbierto(true)}>
          <Plus className="size-4" />
          Nuevo despacho
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-secundario" />
          <Input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar por número"
            aria-label="Buscar por número de despacho"
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          // `key` fuerza un remount de Radix Accordion (y por lo tanto una
          // relectura de `defaultValue`) cada vez que cambia el conjunto de
          // grupos que deberian estar abiertos -- Radix solo respeta
          // `defaultValue` en el montaje inicial, nunca en actualizaciones
          // posteriores. Sin esto, buscar un despacho cuya seccion el
          // usuario habia colapsado a mano no la volvia a abrir: el item
          // coincidia pero quedaba oculto dentro de un Accordion cerrado.
          // Entre un cambio de busqueda/despacho activo y el siguiente, la
          // key se mantiene estable, asi que los toggles manuales del
          // usuario se preservan como siempre (sigue siendo no-controlado).
          <Accordion type="multiple" defaultValue={valoresAbiertos} key={valoresAbiertos.join(",")}>
            {grupos.map((grupo) => {
              const info = ESTADO_INFO[grupo.estado];
              return (
                <AccordionItem key={grupo.estado} value={grupo.estado}>
                  <AccordionTrigger className="px-2">{`${info.label} (${grupo.despachos.length})`}</AccordionTrigger>
                  <AccordionContent className="px-1">
                    {grupo.despachos.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-texto-secundario">Sin despachos.</p>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {grupo.despachos.map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => navigate(`/despachos/${d.id}`)}
                              title={`${d.numero_despacho} · ${d.cliente}`}
                              className={cn(
                                "block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                                d.id === idDespachoActivo
                                  ? "bg-coral/15 text-coral"
                                  : "text-texto hover:bg-surface-border/50",
                              )}
                            >
                              <span className="font-mono">{d.numero_despacho}</span>
                              <span className={d.id === idDespachoActivo ? "text-coral/70" : "text-texto-secundario"}>
                                {" "}
                                · {d.cliente}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>

      <NuevoDespachoDialog open={dialogoAbierto} onOpenChange={setDialogoAbierto} />
    </div>
  );
}
