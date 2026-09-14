import { Pencil, Trash2 } from "lucide-react";

import { useEliminarCargoEspecial } from "@/hooks/useEliminarCargoEspecial";
import type { CargoEspecialArancelOut } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface CargosEspecialesTableProps {
  cargos: CargoEspecialArancelOut[];
  onEditar: (cargo: CargoEspecialArancelOut) => void;
}

/** Tabla de tasas de antidumping/derecho específico por subpartida --
 * mismo patrón que `ReglasValidacionTable`, sin el toggle "activo" (no
 * aplica aquí: un cargo cargado siempre está disponible como default). */
export function CargosEspecialesTable({ cargos, onEditar }: CargosEspecialesTableProps) {
  const eliminar = useEliminarCargoEspecial();

  function confirmarEliminar(cargo: CargoEspecialArancelOut) {
    if (window.confirm(`¿Eliminar el cargo especial de "${cargo.subpartida}"? Esta acción no se puede deshacer.`)) {
      eliminar.mutate(cargo.id);
    }
  }

  if (cargos.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
        No hay cargos especiales configurados todavía.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subpartida</TableHead>
          <TableHead>Antidumping</TableHead>
          <TableHead>Derecho específico</TableHead>
          <TableHead>Nota</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {cargos.map((cargo) => (
          <TableRow key={cargo.id}>
            <TableCell className="font-mono text-xs font-semibold">{cargo.subpartida}</TableCell>
            <TableCell className="font-mono text-xs">
              {cargo.moneda} {cargo.antidumping_monto.toFixed(2)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {cargo.moneda} {cargo.derecho_especifico_monto.toFixed(2)}
            </TableCell>
            <TableCell className="max-w-xs truncate text-xs text-texto-secundario" title={cargo.nota ?? undefined}>
              {cargo.nota ?? "—"}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onEditar(cargo)}
                  aria-label={`Editar ${cargo.subpartida}`}
                  title="Editar"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => confirmarEliminar(cargo)}
                  disabled={eliminar.isPending}
                  aria-label={`Eliminar ${cargo.subpartida}`}
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
  );
}
