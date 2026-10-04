import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { NOMBRE_DOCUMENTO_CORTO } from "@/lib/documentos";
import type { TipoDocumento } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type PasoProcesamiento = "cargando" | "extrayendo" | "validando" | "finalizado";

interface DefinicionPaso {
  paso: PasoProcesamiento;
  etiqueta: string;
}

const PASOS: DefinicionPaso[] = [
  { paso: "cargando", etiqueta: "Cargando archivo" },
  { paso: "extrayendo", etiqueta: "Extrayendo datos" },
  { paso: "validando", etiqueta: "Ejecutando reglas de validación" },
  { paso: "finalizado", etiqueta: "Finalizado" },
];

export interface ProcesamientoModalProps {
  abierto: boolean;
  /** Paso actual mientras no hay error. Ignorado si `mensajeError` viene
   * presente (esta se muestra en su lugar). */
  paso: PasoProcesamiento;
  segundosTranscurridos: number;
  /** Tipos de documento que se estan procesando esta vez (los que estaban
   * pendientes al presionar el boton), para dar contexto sin inventar un
   * nombre de archivo que esta accion no maneja de a uno. */
  tiposEnProceso: TipoDocumento[];
  /** Presente = el pipeline fallo; se muestra en vez de la barra de pasos,
   * con un boton para cerrar (mientras esta en curso, el modal no se
   * puede cerrar a mano -- no hay nada que cancelar del lado del backend). */
  mensajeError: string | null;
  onCerrar: () => void;
}

function formatearTiempo(segundos: number): string {
  const mm = Math.floor(segundos / 60);
  const ss = segundos % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/**
 * Modal de progreso de "Extracción y validación". El backend resuelve
 * todo en una sola llamada (no reporta avance real paso a paso), así que
 * esto simula una progresión plausible mientras esa llamada sigue en
 * vuelo -- el único paso que refleja un hecho real es "Finalizado", que
 * solo aparece cuando la llamada de verdad terminó bien (ver
 * `RevisionTab::manejarProcesar`, que es quien decide cuándo avanzar
 * cada paso). No se puede cerrar mientras está en curso: no hay forma de
 * cancelar el pipeline del lado del backend, así que ocultarlo no
 * cambiaría nada, solo confundiría sobre si sigue corriendo.
 */
export function ProcesamientoModal({
  abierto,
  paso,
  segundosTranscurridos,
  tiposEnProceso,
  mensajeError,
  onCerrar,
}: ProcesamientoModalProps) {
  const indiceActual = PASOS.findIndex((p) => p.paso === paso);

  return (
    <DialogPrimitive.Root open={abierto} onOpenChange={(siguiente) => !siguiente && mensajeError && onCerrar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(evento) => !mensajeError && evento.preventDefault()}
          onPointerDownOutside={(evento) => !mensajeError && evento.preventDefault()}
        >
          {/* Radix exige un Title (accesibilidad); no hace falta mostrarlo
              dos veces si ya hay un encabezado visible mas abajo. */}
          <DialogPrimitive.Title className="sr-only">
            {mensajeError ? "Error al procesar el despacho" : "Procesando el despacho"}
          </DialogPrimitive.Title>

          {mensajeError ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-rojo/15 text-rojo">
                <AlertTriangle className="size-6" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-texto">No se pudo completar</h2>
                <p className="mt-1 text-sm text-texto-secundario">{mensajeError}</p>
              </div>
              <Button type="button" onClick={onCerrar}>
                Cerrar
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5 text-center">
              <Badge variant="coral">Procesando con IA</Badge>

              <div>
                <h2 className="text-base font-semibold text-texto">Extracción y validación</h2>
                {tiposEnProceso.length > 0 && (
                  <p className="mt-1 text-sm text-texto-secundario">{tiposEnProceso.map((tipo) => NOMBRE_DOCUMENTO_CORTO[tipo]).join(", ")}</p>
                )}
              </div>

              <span className="rounded-full bg-surface-border px-3 py-1 font-mono text-sm text-texto tabular-nums">
                {formatearTiempo(segundosTranscurridos)}
              </span>

              <div className="flex w-full items-start justify-between">
                {PASOS.map((definicion, indice) => {
                  const completado = indice < indiceActual || paso === "finalizado";
                  const activo = indice === indiceActual && paso !== "finalizado";
                  return (
                    <div key={definicion.paso} className="flex flex-1 flex-col items-center gap-2 px-1">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          completado
                            ? "border-verde bg-verde text-white"
                            : activo
                              ? "border-coral text-coral"
                              : "border-border text-texto-secundario",
                        )}
                      >
                        {completado ? (
                          <Check className="size-4" />
                        ) : activo ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <span className="size-2 rounded-full bg-current" />
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-[13px] leading-tight",
                          completado || activo ? "text-texto" : "text-texto-secundario",
                        )}
                      >
                        {definicion.etiqueta}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="text-[13px] text-texto-secundario">
                Puede tardar más de un minuto según cuántos documentos haya que procesar.
              </p>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
