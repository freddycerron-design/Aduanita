import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface PaginationProps {
  pagina: number;
  totalPaginas: number;
  onCambiarPagina: (pagina: number) => void;
  /** Deshabilita ambos botones mientras la página siguiente/anterior está
   * en vuelo (evita doble click disparando dos requests). */
  disabled?: boolean;
}

/** Anterior/Siguiente + "Página X de Y" -- suficiente para una grilla que
 * se recorre secuencialmente; no hay salto a una página arbitraria
 * todavía porque ningún listado del app lo necesita hoy. */
export function Pagination({ pagina, totalPaginas, onCambiarPagina, disabled }: PaginationProps) {
  const paginaMaxima = Math.max(totalPaginas, 1);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-texto-secundario">
        Página {pagina} de {paginaMaxima}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || pagina <= 1}
          onClick={() => onCambiarPagina(pagina - 1)}
        >
          <ChevronLeft />
          Anterior
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || pagina >= paginaMaxima}
          onClick={() => onCambiarPagina(pagina + 1)}
        >
          Siguiente
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
