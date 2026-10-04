import { Check } from "lucide-react";

import { NOMBRE_DOCUMENTO_CORTO } from "@/lib/documentos";
import type { DespachoDetalleOut, EstadoDespacho, TipoDocumento } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Los 3 tramos reales de la máquina de estados del backend, en orden
 * (ver CLAUDE.md, "Máquina de estados del despacho"). No se inventan
 * pasos intermedios ("Extraído", "Validado"...): la extracción se puede
 * re-correr sin mover el estado, así que no es un tramo de la ruta sino
 * una acción dentro de Revisión documental -- eso lo cuenta la línea de
 * próxima acción, no la ruta. */
const TRAMOS: { estado: EstadoDespacho; label: string }[] = [
  { estado: "REVISION_DOC", label: "Revisión documental" },
  { estado: "CLASIFICACION", label: "Clasificación" },
  { estado: "FINALIZADO", label: "Finalizado" },
];

/** Mínimos que exige `POST /despachos/{id}/enviar-a-clasificacion`. */
const DOCUMENTOS_MINIMOS: TipoDocumento[] = ["FACTURA", "BL"];

type TonoAccion = "pendiente" | "listo" | "cerrado-ok" | "cerrado-obs";

/** Deriva la próxima acción concreta a partir del detalle -- la misma
 * información que ya se usa en las pestañas, resumida en una línea para
 * que el usuario sepa qué toca sin abrir cada pestaña. */
function proximaAccion(detalle: DespachoDetalleOut): { texto: string; tono: TonoAccion } {
  const { estado } = detalle.despacho;

  if (estado === "FINALIZADO") {
    // tipo_accion: APROBADO = el liquidador aceptó tal cual; EDITADO = la
    // observó y corrigió la subpartida. Sin decisión persistida (caso
    // raro, datos viejos) se dice solo "Cerrado" en vez de adivinar.
    if (detalle.decision?.tipo_accion === "APROBADO") return { texto: "Cerrado: propuesta aceptada", tono: "cerrado-ok" };
    if (detalle.decision?.tipo_accion === "EDITADO") return { texto: "Cerrado: propuesta observada", tono: "cerrado-obs" };
    return { texto: "Cerrado", tono: "cerrado-ok" };
  }

  if (estado === "CLASIFICACION") {
    return { texto: "Esperando decisión del liquidador", tono: "pendiente" };
  }

  // REVISION_DOC: "cargado" = existe la fila del documento (se subió el
  // archivo), independiente de si ya se extrajo.
  const cargados = new Set(detalle.documentos.map((documento) => documento.tipo_documento));
  const faltantes = DOCUMENTOS_MINIMOS.filter((tipo) => !cargados.has(tipo));
  if (faltantes.length > 0) {
    return {
      texto: `Falta cargar: ${faltantes.map((tipo) => NOMBRE_DOCUMENTO_CORTO[tipo]).join(", ")}`,
      tono: "pendiente",
    };
  }
  if (detalle.clasificacion === null) {
    return { texto: "Siguiente: Extracción y validación", tono: "pendiente" };
  }
  return { texto: "Siguiente: enviar a clasificación", tono: "listo" };
}

const COLOR_ACCION: Record<TonoAccion, string> = {
  pendiente: "text-texto",
  listo: "text-coral",
  "cerrado-ok": "text-verde",
  "cerrado-obs": "text-amber",
};

const COLOR_PUNTO: Record<TonoAccion, string> = {
  pendiente: "bg-coral",
  listo: "bg-coral",
  "cerrado-ok": "bg-verde",
  "cerrado-obs": "bg-amber",
};

/**
 * "Ruta del despacho": los 3 tramos como una hoja de ruta (nodos unidos
 * por una línea, no tarjetas) + la próxima acción concreta. Reemplaza al
 * badge de estado del encabezado: el tramo actual ya dice en qué estado
 * está el despacho, y repetirlo en un badge al lado sería ruido.
 *
 * Accesibilidad: `<ol>` (el orden importa), `aria-current="step"` en el
 * tramo actual, y el estado de cada tramo también como texto para
 * lectores de pantalla (el check/color solo es la señal visual).
 */
export function RutaDespacho({ detalle }: { detalle: DespachoDetalleOut }) {
  const indiceActual = TRAMOS.findIndex((tramo) => tramo.estado === detalle.despacho.estado);
  // FINALIZADO es el final de la ruta: se muestra como completado (check
  // verde), no como "en curso" en coral -- ya no hay nada en marcha.
  const finalizado = detalle.despacho.estado === "FINALIZADO";
  const accion = proximaAccion(detalle);

  return (
    <nav aria-label="Ruta del despacho" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <ol className="flex flex-wrap items-center gap-y-1.5">
        {TRAMOS.map((tramo, indice) => {
          const completado = indice < indiceActual || (finalizado && indice === indiceActual);
          const actual = indice === indiceActual;
          return (
            <li
              key={tramo.estado}
              aria-current={actual ? "step" : undefined}
              className="flex items-center"
            >
              {indice > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-2 h-px w-6 sm:w-10",
                    indice <= indiceActual ? "bg-verde/60" : "bg-surface-border",
                  )}
                />
              )}
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    completado
                      ? "border-verde bg-verde/15 text-verde"
                      : actual
                        ? "border-coral bg-coral text-white"
                        : "border-surface-border text-texto-secundario",
                  )}
                >
                  {completado ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : (
                    <span className="text-[11px] font-semibold leading-none">{indice + 1}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "text-[13px] whitespace-nowrap",
                    actual && !finalizado
                      ? "font-semibold text-coral"
                      : completado
                        ? "text-texto"
                        : "text-texto-secundario/70",
                  )}
                >
                  {tramo.label}
                  <span className="sr-only">
                    {completado ? " (completado)" : actual ? " (en curso)" : " (pendiente)"}
                  </span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className={cn("flex items-center gap-2 text-[13px] font-medium", COLOR_ACCION[accion.tono])}>
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", COLOR_PUNTO[accion.tono])} />
        {accion.texto}
      </p>
    </nav>
  );
}
