import { useEffect, useRef, useState } from "react";
import { Filter, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface OpcionFiltroColumna {
  valor: string;
  etiqueta: string;
}

export interface ColumnFilterProps {
  titulo: string;
  opciones: OpcionFiltroColumna[];
  /** Filtro aplicado actualmente; `null` = sin filtro (todo visible). */
  seleccion: string[] | null;
  onAplicar: (seleccion: string[] | null) => void;
  /** Caja de búsqueda arriba de la lista, para acotarla -- pensada para
   * una columna con muchos valores distintos (Cliente); de más para una
   * lista fija corta (Estado), así que es opcional. */
  conBusqueda?: boolean;
}

/**
 * Filtro "estilo Excel" para el header de una columna: ícono de embudo ->
 * popover con un checkbox "(Seleccionar todo)" + uno por cada valor
 * distinto, y Aceptar/Cancelar -- los cambios solo se aplican al
 * Aceptar, igual que el AutoFiltro de Excel (no en vivo con cada click).
 * "(Seleccionar todo)" actúa sobre lo que esté visible tras la búsqueda
 * (no sobre valores ocultos por ella), también igual que Excel.
 */
export function ColumnFilter({ titulo, opciones, seleccion, onAplicar, conBusqueda }: ColumnFilterProps) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  // Borrador local: se reinicia cada vez que se ABRE el popover, a partir
  // del filtro ya aplicado (o "todo marcado" si no hay ninguno).
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const refSeleccionarTodo = useRef<HTMLInputElement>(null);

  const activo = seleccion !== null;

  function alAbrir(siguiente: boolean) {
    if (siguiente) {
      setBusqueda("");
      setMarcados(new Set(seleccion ?? opciones.map((o) => o.valor)));
    }
    setAbierto(siguiente);
  }

  const opcionesFiltradas = busqueda.trim()
    ? opciones.filter((o) => o.etiqueta.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : opciones;

  const marcadosVisibles = opcionesFiltradas.filter((o) => marcados.has(o.valor)).length;
  const todoMarcado = opcionesFiltradas.length > 0 && marcadosVisibles === opcionesFiltradas.length;
  const algoMarcado = marcadosVisibles > 0;

  // El checkbox nativo no tiene un estado "indeterminado" como atributo
  // HTML -- hay que setear la propiedad del DOM a mano via ref.
  useEffect(() => {
    if (refSeleccionarTodo.current) {
      refSeleccionarTodo.current.indeterminate = algoMarcado && !todoMarcado;
    }
  }, [algoMarcado, todoMarcado]);

  function alternar(valor: string) {
    setMarcados((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(valor)) siguiente.delete(valor);
      else siguiente.add(valor);
      return siguiente;
    });
  }

  function alternarTodoLoVisible() {
    setMarcados((previos) => {
      const siguiente = new Set(previos);
      const marcarTodo = !todoMarcado;
      for (const opcion of opcionesFiltradas) {
        if (marcarTodo) siguiente.add(opcion.valor);
        else siguiente.delete(opcion.valor);
      }
      return siguiente;
    });
  }

  function aceptar() {
    // Todo marcado equivale a "sin filtro" -- se manda null para no
    // arrastrar un filtro que en la practica no restringe nada.
    onAplicar(marcados.size === opciones.length ? null : Array.from(marcados));
    setAbierto(false);
  }

  return (
    <Popover open={abierto} onOpenChange={alAbrir}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filtrar por ${titulo}`}
          title={`Filtrar por ${titulo}`}
          className={cn(
            "rounded p-0.5 transition-colors hover:bg-surface-border/60",
            activo ? "text-coral" : "text-texto-secundario",
          )}
        >
          <Filter className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0">
        {conBusqueda && (
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-texto-secundario" />
              <Input
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Buscar"
                aria-label={`Buscar dentro del filtro de ${titulo}`}
                className="h-8 pl-8 text-xs"
                autoFocus
              />
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium hover:bg-surface-border/40">
          <input
            ref={refSeleccionarTodo}
            type="checkbox"
            className="size-3.5 rounded border-border"
            checked={todoMarcado}
            onChange={alternarTodoLoVisible}
          />
          <span>(Seleccionar todo)</span>
        </label>

        <div className="max-h-52 overflow-y-auto p-2">
          {opcionesFiltradas.length === 0 ? (
            <p className="px-1 py-2 text-xs text-texto-secundario">Sin resultados.</p>
          ) : (
            opcionesFiltradas.map((opcion) => (
              <label
                key={opcion.valor}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-surface-border/40"
              >
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-border"
                  checked={marcados.has(opcion.valor)}
                  onChange={() => alternar(opcion.valor)}
                />
                <span className="truncate">{opcion.etiqueta}</span>
              </label>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={aceptar}>
            Aceptar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
