import type { ReactNode } from "react";

// Palabras que el full-text en español ignora: resaltarlas solo ensucia.
const PALABRAS_VACIAS = new Set([
  "de", "del", "la", "las", "el", "los", "un", "una", "unos", "unas", "y", "o", "u", "e",
  "en", "con", "sin", "por", "para", "al", "a", "que", "se", "su", "sus", "lo", "como", "mas",
]);

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Raíz aproximada de una palabra: la búsqueda usa stemming en español
 * ("sacos" encuentra "saco"), así que se resalta por prefijo de la raíz y
 * no por coincidencia exacta. */
function raiz(palabra: string): string {
  let r = palabra.replace(/(es|s)$/, "");
  if (r.length > 4) r = r.replace(/[aeiou]$/, "");
  return r.length >= 3 ? r : palabra;
}

export function raicesDeConsulta(consulta: string): string[] {
  return normalizar(consulta)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length >= 3 && !PALABRAS_VACIAS.has(p))
    .map(raiz);
}

/** Devuelve `texto` con las palabras que empiezan con alguna de `raices`
 * envueltas en <mark>. */
export function resaltar(texto: string, raices: string[]): ReactNode {
  if (raices.length === 0) return texto;
  return texto.split(/([\p{L}\p{N}]+)/u).map((parte, i) => {
    const normal = normalizar(parte);
    return raices.some((r) => normal.startsWith(r)) ? (
      <mark key={i} className="rounded-sm bg-resaltado px-0.5 text-resaltado-texto">
        {parte}
      </mark>
    ) : (
      parte
    );
  });
}
