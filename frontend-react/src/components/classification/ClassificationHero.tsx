import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { NivelConfianza } from "@/lib/types";

const COLOR_POR_CONFIANZA: Record<NivelConfianza, NonNullable<BadgeProps["variant"]>> = {
  ALTA: "verde",
  MEDIA: "amber",
  BAJA: "rojo",
};

export interface ClassificationHeroProps {
  /** Codigo de subpartida arancelaria, mostrado en grande con tipografia mono. */
  subpartida: string;
  /** Nivel de confianza de la propuesta -- define el color del badge
   * (verde/amber/rojo) y, si no se pasa `etiquetaSecundaria`, tambien su
   * texto. */
  confianza?: NivelConfianza;
  /** Score numerico 0-1 del que se deriva `confianza` (ver
   * services/gemini_classifier.py::_derivar_nivel_confianza). Opcional --
   * el hero simplificado de un despacho cerrado (fallback a `decision`,
   * que no guarda el score original) no lo pasa. */
  scoreConfianza?: number;
  /** Texto del badge cuando se quiere mostrar algo distinto al nivel de
   * confianza (p.ej. "APROBADO"/"EDITADO" en el hero simplificado de un
   * despacho ya cerrado, reusando el color de `confianza` para conservar
   * la semantica visual verde=conforme / rojo=observado). Por defecto
   * muestra `confianza`. */
  etiquetaSecundaria?: string;
  /** Texto descriptivo debajo del hero -- normalmente el sustento legal
   * (RGI) de la propuesta, o una nota generica cuando no aplica. */
  sustentoLegal?: string;
  /** Titulo en negrita antepuesto a `sustentoLegal` (p.ej. "Sustento legal
   * (RGI):"). Omitir para mostrar `sustentoLegal` como oracion simple. */
  sustentoLabel?: string;
}

/**
 * "Hero" de la propuesta de clasificacion: subpartida sugerida en grande +
 * badge de confianza + sustento legal. Reusable tanto para la propuesta
 * completa (`PropuestaClasificacionOut`, estado CLASIFICACION) como para
 * el resumen simplificado de una decision ya persistida en un despacho
 * cerrado (la cache `clasificacion` en memoria del backend se limpia al
 * decidir, ver `HistorialClasificacionOut`).
 */
export function ClassificationHero({
  subpartida,
  confianza,
  scoreConfianza,
  etiquetaSecundaria,
  sustentoLegal,
  sustentoLabel,
}: ClassificationHeroProps) {
  const etiqueta = etiquetaSecundaria ?? confianza;
  const variante = confianza ? COLOR_POR_CONFIANZA[confianza] : "neutral";

  return (
    <Card className="overflow-hidden">
      <div className="h-1.5 w-full bg-gradient-to-r from-coral to-amber" aria-hidden="true" />
      <div className="flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-2xl font-bold tracking-tight text-texto">{subpartida}</span>
          {etiqueta && <Badge variant={variante}>{etiqueta}</Badge>}
          {scoreConfianza !== undefined && (
            <span className="text-sm font-semibold text-texto-secundario">
              {Math.round(scoreConfianza * 100)}% de confianza
            </span>
          )}
        </div>
        {sustentoLegal && (
          <p className="text-sm leading-relaxed text-texto-secundario">
            {sustentoLabel && <span className="font-semibold text-texto">{sustentoLabel} </span>}
            {sustentoLegal}
          </p>
        )}
      </div>
    </Card>
  );
}
