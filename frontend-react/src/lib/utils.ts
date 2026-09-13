import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases condicionales (clsx) y resuelve conflictos de utilidades
 * de Tailwind (tailwind-merge) -- helper estandar usado por todos los
 * primitivos en components/ui. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Dispara la descarga de un Blob ya en memoria (sin ida y vuelta al
 * backend) via un <a download> temporal -- funciona en cualquier
 * navegador real, no confundir con las restricciones de descarga que
 * tienen los artifacts embebidos. */
export function descargarBlob(blob: Blob, nombreArchivo: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}
