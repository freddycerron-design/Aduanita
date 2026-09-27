/** Formatea una fecha ISO como "12 mar 2026"; "—" si no hay. Compartido
 * por cualquier pantalla que muestre una fecha de despacho (Explorador,
 * Portal del cliente). */
export function formatearFecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
