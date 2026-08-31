import { Pencil, Trash2 } from "lucide-react";

import { useEliminarReglaValidacion } from "@/hooks/useEliminarReglaValidacion";
import { useGuardarReglaValidacion } from "@/hooks/useGuardarReglaValidacion";
import type { ReglaValidacionOut } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ETIQUETA_TIPO: Record<ReglaValidacionOut["tipo_comparacion"], string> = {
  RANGO_ASIMETRICO: "Rango numérico",
  IGUALDAD_EXACTA: "Igualdad",
  TEXTO_FUZZY: "Texto difuso",
};

export interface ReglasValidacionTableProps {
  reglas: ReglaValidacionOut[];
  onEditar: (regla: ReglaValidacionOut) => void;
}

export function ReglasValidacionTable({ reglas, onEditar }: ReglasValidacionTableProps) {
  const guardar = useGuardarReglaValidacion();
  const eliminar = useEliminarReglaValidacion();

  function alternarActivo(regla: ReglaValidacionOut) {
    const { id, creado_en, actualizado_en, ...datos } = regla;
    guardar.mutate({ id, datos: { ...datos, activo: !regla.activo } });
  }

  function confirmarEliminar(regla: ReglaValidacionOut) {
    if (window.confirm(`¿Eliminar la regla "${regla.nombre}" (${regla.codigo})? Esta acción no se puede deshacer.`)) {
      eliminar.mutate(regla.id);
    }
  }

  if (reglas.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
        No hay reglas de validación configuradas todavía.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Código</TableHead>
          <TableHead>Comparación</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Activa</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {reglas.map((regla) => (
          <TableRow key={regla.id}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-xs font-semibold">{regla.codigo}</span>
                <span className="text-texto-secundario">{regla.nombre}</span>
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs text-texto-secundario">
              {regla.documento_a}.{regla.campo_a} → {regla.documento_b}.{regla.campo_b}
            </TableCell>
            <TableCell>
              <Badge variant="coral">{ETIQUETA_TIPO[regla.tipo_comparacion]}</Badge>
            </TableCell>
            <TableCell>
              <button
                type="button"
                onClick={() => alternarActivo(regla)}
                disabled={guardar.isPending}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                aria-pressed={regla.activo}
                aria-label={regla.activo ? "Desactivar regla" : "Activar regla"}
              >
                <Badge variant={regla.activo ? "verde" : "neutral"}>{regla.activo ? "Activa" : "Inactiva"}</Badge>
              </button>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onEditar(regla)}
                  aria-label={`Editar ${regla.nombre}`}
                  title="Editar"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => confirmarEliminar(regla)}
                  disabled={eliminar.isPending}
                  aria-label={`Eliminar ${regla.nombre}`}
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
