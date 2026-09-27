import { useState } from "react";
import type { FormEvent } from "react";
import { FolderOpen, Plus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ESTADO_INFO } from "@/lib/estado";
import { formatearFecha } from "@/lib/fecha";
import { useDespachosPaginados } from "@/hooks/useDespachosPaginados";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NuevoDespachoDialog } from "@/components/layout/NuevoDespachoDialog";

const TAMANIO_PAGINA = 15;

/**
 * Primera pestaña de la sección Validador: crear despacho, buscar y
 * recorrer el listado completo. Antes vivía en un panel lateral angosto
 * (`ExplorerPanel`, ya eliminado) con agrupado por estado y sin paginar;
 * ahora es una grilla a lo ancho de la pantalla con paginación real de
 * backend, porque un panel de 288px no alcanza para columnas de cliente/
 * descripción/gestor.
 *
 * La búsqueda es del backend (`GET /despachos?busqueda=`), no un filtro
 * sobre datos ya traídos -- por eso solo dispara al enviar el formulario
 * (Enter o el botón), igual que `ArancelPage`, y no en cada tecla.
 */
export function ExploradorTab() {
  const [entradaBusqueda, setEntradaBusqueda] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const navigate = useNavigate();

  const { data, isLoading, isFetching, isError, error } = useDespachosPaginados({
    pagina,
    limite: TAMANIO_PAGINA,
    busqueda,
  });

  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / TAMANIO_PAGINA)) : 1;

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setBusqueda(entradaBusqueda.trim());
    setPagina(1); // una búsqueda nueva vuelve siempre a la primera página
  }

  function irADespacho(id: string) {
    navigate(`/despachos/${id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={buscar} className="flex flex-1 gap-2 sm:max-w-sm">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-secundario" />
            <Input
              value={entradaBusqueda}
              onChange={(evento) => setEntradaBusqueda(evento.target.value)}
              placeholder="Buscar por número, cliente o descripción"
              aria-label="Buscar despachos"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" disabled={isFetching}>
            Buscar
          </Button>
        </form>
        <Button type="button" onClick={() => setDialogoAbierto(true)}>
          <Plus />
          Nuevo despacho
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-rojo">
          No se pudo cargar el listado{error instanceof Error ? `: ${error.message}` : "."}
        </p>
      ) : !data || data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center">
          <FolderOpen className="size-9 text-texto-secundario" strokeWidth={1.5} />
          <p className="text-sm text-texto-secundario">
            {busqueda
              ? `Ningún despacho coincide con "${busqueda}".`
              : "Todavía no hay despachos. Crea el primero para empezar."}
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nro</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Fecha creación</TableHead>
                <TableHead>Gestor</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((despacho) => {
                const info = ESTADO_INFO[despacho.estado];
                return (
                  <TableRow
                    key={despacho.id}
                    onClick={() => irADespacho(despacho.id)}
                    onKeyDown={(evento) => {
                      if (evento.key === "Enter" || evento.key === " ") {
                        evento.preventDefault();
                        irADespacho(despacho.id);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Abrir despacho ${despacho.numero_despacho}`}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">
                      {despacho.numero_despacho}
                    </TableCell>
                    <TableCell>{despacho.cliente}</TableCell>
                    <TableCell className="max-w-xs truncate text-texto-secundario" title={despacho.descripcion ?? undefined}>
                      {despacho.descripcion ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-texto-secundario">
                      {formatearFecha(despacho.fecha_creacion)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-texto-secundario">
                      {despacho.gestor ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={info.variant}>{info.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Pagination
            pagina={pagina}
            totalPaginas={totalPaginas}
            onCambiarPagina={setPagina}
            disabled={isFetching}
          />
        </>
      )}

      <NuevoDespachoDialog open={dialogoAbierto} onOpenChange={setDialogoAbierto} />
    </div>
  );
}
