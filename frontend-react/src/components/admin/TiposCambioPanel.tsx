import { useState } from "react";
import type { FormEvent } from "react";
import { Download, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  useEliminarTipoCambio,
  useGuardarTipoCambio,
  useSincronizarTipoCambio,
  useTiposCambio,
} from "@/hooks/useTiposCambio";
import type { TipoCambioOut } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** `2026-10-08` -> `08/10/2026`, sin pasar por Date (evita el corrimiento
 * de un día por zona horaria al parsear una fecha sola). */
function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

/** Hoy en Lima como AAAA-MM-DD (el backend también usa la fecha de Lima). */
function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

/**
 * Mantenimiento del tipo de cambio SUNAT. La tabla se llena sola cada vez
 * que se calcula una preliquidación sin el tipo de cambio del día; acá se
 * puede traer el de hoy a demanda y cargar o corregir fechas a mano (por
 * ejemplo, días pasados que nadie consultó: SUNAT solo publica el del día
 * en formato abierto).
 */
export function TiposCambioPanel() {
  const { data: tipos, isLoading, isError } = useTiposCambio();
  const sincronizar = useSincronizarTipoCambio();
  const eliminar = useEliminarTipoCambio();
  const [editando, setEditando] = useState<TipoCambioOut | "nuevo" | null>(null);

  function confirmarEliminar(tipo: TipoCambioOut) {
    if (window.confirm(`¿Eliminar el tipo de cambio del ${formatearFecha(tipo.fecha)}?`)) {
      eliminar.mutate(tipo.fecha);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-[13px] text-texto-secundario">
          Tipo de cambio del dólar publicado por SUNAT. La preliquidación usa el de venta del día para mostrar
          los montos en soles; si todavía no está guardado, lo trae de SUNAT automáticamente.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending}>
            {sincronizar.isPending ? <Loader2 className="animate-spin" /> : <Download />}
            Traer el de hoy de SUNAT
          </Button>
          <Button type="button" size="sm" onClick={() => setEditando("nuevo")}>
            <Plus />
            Cargar a mano
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <p className="text-sm text-rojo">No se pudo cargar el tipo de cambio.</p>
      ) : !tipos || tipos.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
          Todavía no hay tipos de cambio guardados. Usa &quot;Traer el de hoy de SUNAT&quot; o calcula una
          preliquidación.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Compra</TableHead>
              <TableHead className="text-right">Venta</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tipos.map((tipo) => (
              <TableRow key={tipo.fecha}>
                <TableCell className="whitespace-nowrap tabular-nums">{formatearFecha(tipo.fecha)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{tipo.compra.toFixed(3)}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">{tipo.venta.toFixed(3)}</TableCell>
                <TableCell>
                  <Badge variant={tipo.fuente === "SUNAT" ? "verde" : "amber"}>
                    {tipo.fuente === "SUNAT" ? "SUNAT" : "Manual"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditando(tipo)}
                      aria-label={`Corregir el ${formatearFecha(tipo.fecha)}`}
                      title="Corregir"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => confirmarEliminar(tipo)}
                      disabled={eliminar.isPending}
                      aria-label={`Eliminar el ${formatearFecha(tipo.fecha)}`}
                      title="Eliminar"
                      className="text-rojo hover:bg-rojo/10 hover:text-rojo"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editando !== null && (
        <TipoCambioForm
          // key: cada apertura arranca con los valores de la fila elegida.
          key={editando === "nuevo" ? "nuevo" : editando.fecha}
          tipo={editando === "nuevo" ? null : editando}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function TipoCambioForm({ tipo, onCerrar }: { tipo: TipoCambioOut | null; onCerrar: () => void }) {
  const guardar = useGuardarTipoCambio();
  const [fecha, setFecha] = useState(tipo?.fecha ?? hoyLima());
  const [compra, setCompra] = useState(tipo ? tipo.compra.toFixed(3) : "");
  const [venta, setVenta] = useState(tipo ? tipo.venta.toFixed(3) : "");

  function alEnviar(evento: FormEvent) {
    evento.preventDefault();
    guardar.mutate(
      { fecha, datos: { compra: Number(compra), venta: Number(venta) } },
      { onSuccess: onCerrar },
    );
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        <form onSubmit={alEnviar}>
          <DialogHeader>
            <DialogTitle>{tipo ? `Corregir el ${formatearFecha(tipo.fecha)}` : "Cargar tipo de cambio"}</DialogTitle>
            <DialogDescription>
              Queda marcado como manual: traer el de SUNAT no lo sobrescribe.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tc-fecha">Fecha</Label>
              <Input
                id="tc-fecha"
                type="date"
                required
                max={hoyLima()}
                value={fecha}
                disabled={tipo !== null}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="tc-compra">Compra (S/)</Label>
                <Input
                  id="tc-compra"
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  value={compra}
                  onChange={(e) => setCompra(e.target.value)}
                  className="text-right tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tc-venta">Venta (S/)</Label>
                <Input
                  id="tc-venta"
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  value={venta}
                  onChange={(e) => setVenta(e.target.value)}
                  className="text-right tabular-nums"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar} disabled={guardar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
