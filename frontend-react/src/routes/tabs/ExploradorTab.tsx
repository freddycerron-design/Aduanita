import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FolderOpen, Plus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { CampoOrdenDespachos, DireccionOrden } from "@/lib/api";
import { ESTADO_INFO, ORDEN_ESTADOS } from "@/lib/estado";
import { formatearFecha } from "@/lib/fecha";
import type { DespachoOut, EstadoDespacho } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useClientesDistintosDeDespachos } from "@/hooks/useClientesDistintosDeDespachos";
import { useDespachosPaginados } from "@/hooks/useDespachosPaginados";
import { useGestoresDistintosDeDespachos } from "@/hooks/useGestoresDistintosDeDespachos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnFilter } from "@/components/ui/column-filter";
import { ColumnSort } from "@/components/ui/column-sort";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NuevoDespachoDialog } from "@/components/layout/NuevoDespachoDialog";

const TAMANIO_PAGINA = 15;
// La vista agrupada trae TODO lo que coincide con los filtros en una sola
// pagina grande (se agrupa del lado del cliente, no tiene sentido pedir
// solo 15 y agruparlos aparte) -- 500 es el tope que el backend admite.
const LIMITE_AGRUPADO = 500;

/** Opciones fijas del filtro de Estado -- a diferencia de Cliente/Gestor,
 * no hace falta traerlas del backend: son las 3 del enum, siempre las
 * mismas. */
const OPCIONES_ESTADO = ORDEN_ESTADOS.map((estado) => ({ valor: estado, etiqueta: ESTADO_INFO[estado].label }));

type Vista = "lista" | "cliente" | "estado";

const VISTAS: { valor: Vista; etiqueta: string }[] = [
  { valor: "lista", etiqueta: "Lista" },
  { valor: "cliente", etiqueta: "Agrupar por cliente" },
  { valor: "estado", etiqueta: "Agrupar por estado" },
];

interface Orden {
  campo: CampoOrdenDespachos;
  direccion: DireccionOrden;
}

/**
 * Primera pestaña de la sección Validador: crear despacho, buscar,
 * filtrar, ordenar, agrupar y recorrer el listado completo. Antes vivía
 * en un panel lateral angosto (`ExplorerPanel`, ya eliminado) con
 * agrupado fijo por estado y sin paginar; ahora es una grilla a lo ancho
 * de la pantalla, con filtros "estilo Excel" en Cliente/Gestor/Estado
 * (checkbox + Aceptar/Cancelar, ver `ColumnFilter`), orden en Nro/Fecha
 * creación (flecha en el header, ver `ColumnSort`), y un toggle de vista
 * para agrupar el mismo listado por Cliente o por Estado -- todo resuelto
 * por el backend (`GET /despachos`), no filtrado/ordenado sobre datos ya
 * traídos.
 *
 * La vista agrupada reutiliza la MISMA fila de encabezado (con los
 * mismos controles de filtro/orden, en el mismo lugar) en vez de un
 * Accordion con una tabla por grupo: eso hubiera repetido esos controles
 * una vez por grupo, y la funcionalidad tiene que vivir en el título de
 * cada columna, no repetida por todas partes. En su lugar, las filas se
 * reordenan para que las de un mismo grupo queden contiguas y se
 * intercala una fila divisoria (con la etiqueta y el conteo) antes de
 * cada grupo -- una sola tabla, un solo encabezado.
 *
 * La búsqueda de texto libre sigue el mismo patrón que `ArancelPage`:
 * dispara al enviar el formulario (Enter o el botón), no en cada tecla.
 */
export function ExploradorTab() {
  const [entradaBusqueda, setEntradaBusqueda] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [estadosFiltro, setEstadosFiltro] = useState<EstadoDespacho[] | null>(null);
  const [clientesFiltro, setClientesFiltro] = useState<string[] | null>(null);
  const [gestoresFiltro, setGestoresFiltro] = useState<string[] | null>(null);
  const [orden, setOrden] = useState<Orden>({ campo: "fecha_creacion", direccion: "desc" });
  const [pagina, setPagina] = useState(1);
  const [vista, setVista] = useState<Vista>("lista");
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const navigate = useNavigate();

  const { data: clientesDistintos } = useClientesDistintosDeDespachos();
  const opcionesCliente = (clientesDistintos ?? []).map((valor) => ({ valor, etiqueta: valor }));

  const { data: gestoresDistintos } = useGestoresDistintosDeDespachos();
  const opcionesGestor = (gestoresDistintos ?? []).map((g) => ({ valor: g.id, etiqueta: g.nombre_completo }));

  const agrupando = vista !== "lista";

  const { data, isLoading, isFetching, isError, error } = useDespachosPaginados({
    pagina: agrupando ? 1 : pagina,
    limite: agrupando ? LIMITE_AGRUPADO : TAMANIO_PAGINA,
    busqueda,
    estados: estadosFiltro ?? undefined,
    clientes: clientesFiltro ?? undefined,
    gestores: gestoresFiltro ?? undefined,
    ordenCampo: orden.campo,
    ordenDireccion: orden.direccion,
  });

  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / TAMANIO_PAGINA)) : 1;
  // En vista agrupada, si hay mas despachos filtrados que LIMITE_AGRUPADO,
  // los grupos quedan incompletos -- se avisa en vez de mostrarlo callado.
  const truncado = agrupando && !!data && data.total > data.items.length;

  const filas = useMemo(() => construirFilas(data?.items ?? [], vista), [data, vista]);

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setBusqueda(entradaBusqueda.trim());
    setPagina(1); // toda busqueda/filtro/orden nuevo vuelve a la primera pagina
  }

  function aplicarEstados(seleccion: string[] | null) {
    setEstadosFiltro(seleccion as EstadoDespacho[] | null);
    setPagina(1);
  }

  function aplicarClientes(seleccion: string[] | null) {
    setClientesFiltro(seleccion);
    setPagina(1);
  }

  function aplicarGestores(seleccion: string[] | null) {
    setGestoresFiltro(seleccion);
    setPagina(1);
  }

  function ordenarPor(campo: CampoOrdenDespachos) {
    setOrden((actual) =>
      actual.campo === campo
        ? { campo, direccion: actual.direccion === "asc" ? "desc" : "asc" }
        : { campo, direccion: "asc" },
    );
    setPagina(1);
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

      <div className="flex flex-wrap items-center gap-2">
        {VISTAS.map((v) => (
          <button
            key={v.valor}
            type="button"
            onClick={() => setVista(v.valor)}
            aria-pressed={vista === v.valor}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              vista === v.valor
                ? "border-coral bg-coral/15 text-coral"
                : "border-border bg-surface text-texto-secundario hover:text-texto",
            )}
          >
            {v.etiqueta}
          </button>
        ))}
      </div>

      {truncado && data && (
        <p className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber">
          Mostrando {data.items.length} de {data.total} despachos que coinciden -- acota la búsqueda o los
          filtros para ver el resto agrupado.
        </p>
      )}

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
            {busqueda || estadosFiltro || clientesFiltro || gestoresFiltro
              ? "Ningún despacho coincide con la búsqueda o los filtros."
              : "Todavía no hay despachos. Crea el primero para empezar."}
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <div className="flex items-center gap-1.5">
                    Nro
                    <ColumnSort
                      titulo="Nro"
                      activo={orden.campo === "numero_despacho"}
                      direccion={orden.direccion}
                      onClick={() => ordenarPor("numero_despacho")}
                    />
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-1.5">
                    Cliente
                    <ColumnFilter
                      titulo="Cliente"
                      opciones={opcionesCliente}
                      seleccion={clientesFiltro}
                      onAplicar={aplicarClientes}
                      conBusqueda
                    />
                  </div>
                </TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1.5">
                    Fecha creación
                    <ColumnSort
                      titulo="Fecha creación"
                      activo={orden.campo === "fecha_creacion"}
                      direccion={orden.direccion}
                      onClick={() => ordenarPor("fecha_creacion")}
                    />
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-1.5">
                    Gestor
                    <ColumnFilter
                      titulo="Gestor"
                      opciones={opcionesGestor}
                      seleccion={gestoresFiltro}
                      onAplicar={aplicarGestores}
                      conBusqueda
                    />
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-1.5">
                    Estado
                    <ColumnFilter
                      titulo="Estado"
                      opciones={OPCIONES_ESTADO}
                      seleccion={estadosFiltro}
                      onAplicar={aplicarEstados}
                    />
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((fila) =>
                fila.tipo === "divisor" ? (
                  <TableRow key={`divisor-${fila.clave}`} className="hover:bg-transparent">
                    <TableCell
                      colSpan={6}
                      className="bg-surface py-2 text-xs font-bold uppercase tracking-wide text-texto-secundario"
                    >
                      {fila.etiqueta} ({fila.cantidad})
                    </TableCell>
                  </TableRow>
                ) : (
                  <FilaDespacho key={fila.despacho.id} despacho={fila.despacho} onAbrir={irADespacho} />
                ),
              )}
            </TableBody>
          </Table>

          {!agrupando && (
            <Pagination
              pagina={pagina}
              totalPaginas={totalPaginas}
              onCambiarPagina={setPagina}
              disabled={isFetching}
            />
          )}
        </>
      )}

      <NuevoDespachoDialog open={dialogoAbierto} onOpenChange={setDialogoAbierto} />
    </div>
  );
}

type FilaGrilla =
  | { tipo: "divisor"; clave: string; etiqueta: string; cantidad: number }
  | { tipo: "despacho"; despacho: DespachoOut };

/** Agrupa `items` por Cliente o Estado (vista "lista" los deja tal cual,
 * sin filas divisorias) preservando el orden relativo que ya trae el
 * backend dentro de cada grupo -- el orden elegido en el header
 * (Nro/Fecha) sigue aplicando DENTRO de cada grupo, agrupar no lo pisa. */
function construirFilas(items: DespachoOut[], vista: Vista): FilaGrilla[] {
  if (vista === "lista") {
    return items.map((despacho) => ({ tipo: "despacho", despacho }));
  }

  const clave = vista === "cliente" ? (d: DespachoOut) => d.cliente : (d: DespachoOut) => d.estado;
  const grupos = new Map<string, DespachoOut[]>();
  for (const item of items) {
    const k = clave(item);
    const lista = grupos.get(k);
    if (lista) lista.push(item);
    else grupos.set(k, [item]);
  }

  const entradas = Array.from(grupos.entries());
  entradas.sort(([a], [b]) =>
    vista === "estado"
      ? ORDEN_ESTADOS.indexOf(a as EstadoDespacho) - ORDEN_ESTADOS.indexOf(b as EstadoDespacho)
      : a.localeCompare(b, "es"),
  );

  const filas: FilaGrilla[] = [];
  for (const [valor, despachos] of entradas) {
    const etiqueta = vista === "estado" ? ESTADO_INFO[valor as EstadoDespacho].label : valor;
    filas.push({ tipo: "divisor", clave: valor, etiqueta, cantidad: despachos.length });
    for (const despacho of despachos) filas.push({ tipo: "despacho", despacho });
  }
  return filas;
}

/** Una fila de datos de la grilla, clickeable para abrir el despacho.
 * Compartida por la vista plana y la agrupada -- ambas dibujan la misma
 * fila, solo cambia si hay filas divisorias intercaladas o no. */
function FilaDespacho({ despacho, onAbrir }: { despacho: DespachoOut; onAbrir: (id: string) => void }) {
  const info = ESTADO_INFO[despacho.estado];

  return (
    <TableRow
      onClick={() => onAbrir(despacho.id)}
      onKeyDown={(evento) => {
        if (evento.key === "Enter" || evento.key === " ") {
          evento.preventDefault();
          onAbrir(despacho.id);
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
      <TableCell className="whitespace-nowrap text-texto-secundario">{despacho.gestor ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={info.variant}>{info.label}</Badge>
      </TableCell>
    </TableRow>
  );
}
