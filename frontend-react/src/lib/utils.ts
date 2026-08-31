import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases condicionales (clsx) y resuelve conflictos de utilidades
 * de Tailwind (tailwind-merge) -- helper estandar usado por todos los
 * primitivos en components/ui. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
