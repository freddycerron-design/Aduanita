import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ColumnSortProps {
  titulo: string;
  /** true si esta es la columna por la que se está ordenando ahora mismo
   * (solo una a la vez, como un click normal de encabezado en Excel). */
  activo: boolean;
  direccion: "asc" | "desc";
  onClick: () => void;
}

/** Botón de orden para el header de una columna: flecha neutra si esta
 * columna no es el orden activo, o apuntando según la dirección si lo
 * es. Un click hace que esta pase a ser la columna activa (ascendente por
 * defecto); un segundo click sobre la misma invierte la dirección -- la
 * lógica de eso vive en quien lo usa, este componente solo dibuja. */
export function ColumnSort({ titulo, activo, direccion, onClick }: ColumnSortProps) {
  const Icono = !activo ? ArrowUpDown : direccion === "asc" ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ordenar por ${titulo}`}
      title={`Ordenar por ${titulo}`}
      className={cn(
        "rounded p-0.5 transition-colors hover:bg-surface-border/60",
        activo ? "text-coral" : "text-texto-secundario",
      )}
    >
      <Icono className="size-3.5" />
    </button>
  );
}
