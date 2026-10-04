import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBuscarArancel } from "@/hooks/useBuscarArancel";
import type { NivelConfianza } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLOR_POR_CONFIANZA: Record<NivelConfianza, NonNullable<BadgeProps["variant"]>> = {
  ALTA: "verde",
  MEDIA: "amber",
  BAJA: "rojo",
};

/** Texto legible del nivel -- el enum (ALTA/MEDIA/BAJA) es interno. */
const ETIQUETA_CONFIANZA: Record<NivelConfianza, string> = {
  ALTA: "Confianza alta",
  MEDIA: "Confianza media",
  BAJA: "Confianza baja",
};

/** Relleno de la barra de medición, mismo semáforo que el badge. */
const RELLENO_POR_CONFIANZA: Record<NivelConfianza, string> = {
  ALTA: "bg-verde",
  MEDIA: "bg-amber",
  BAJA: "bg-rojo",
};

export interface ClassificationHeroProps {
  /** Código de subpartida arancelaria, mostrado en grande con tipografía mono. */
  subpartida: string;
  /** Nivel de confianza de la propuesta -- define el color del badge
   * (verde/amber/rojo) y, si no se pasa `etiquetaSecundaria`, también su
   * texto ("Confianza alta", etc.). */
  confianza?: NivelConfianza;
  /** Score numérico 0-1 del que se deriva `confianza` (ver
   * services/gemini_classifier.py::_derivar_nivel_confianza). Opcional --
   * el hero simplificado de un despacho cerrado (fallback a `decision`,
   * que no guarda el score original) no lo pasa, y entonces no se dibuja
   * la barra de medición. */
  scoreConfianza?: number;
  /** Texto YA LEGIBLE del badge cuando se quiere mostrar algo distinto al
   * nivel de confianza (p.ej. "Aprobado"/"Editado" en el hero simplificado
   * de un despacho ya cerrado, reusando el color de `confianza` para
   * conservar la semántica visual verde=conforme / rojo=observado). Quien
   * llama es responsable de traducir el enum -- este componente no conoce
   * los valores de `tipo_accion`. */
  etiquetaSecundaria?: string;
  /** Texto descriptivo debajo del hero -- normalmente el sustento legal
   * (RGI) de la propuesta, o una nota genérica cuando no aplica. */
  sustentoLegal?: string;
  /** Título en negrita antepuesto a `sustentoLegal` (p.ej. "Sustento legal
   * (RGI):"). Omitir para mostrar `sustentoLegal` como oración simple. */
  sustentoLabel?: string;
  /** Rótulo sobre el código. Por defecto "Subpartida propuesta"; el hero
   * de un despacho cerrado muestra la subpartida FINAL del liquidador, no
   * la propuesta de la IA, y lo dice. */
  titulo?: string;
}

/**
 * "Hero" de la propuesta de clasificación: el momento clave del producto.
 * Subpartida sugerida en grande + descripción oficial y ad valorem del
 * Arancel Nacional + confianza (badge y barra) + sustento legal. Reusable
 * tanto para la propuesta completa (`PropuestaClasificacionOut`, estado
 * CLASIFICACION) como para el resumen simplificado de una decisión ya
 * persistida en un despacho cerrado (la cache `clasificacion` en memoria
 * del backend se limpia al decidir, ver `HistorialClasificacionOut`).
 */
export function ClassificationHero({
  subpartida,
  confianza,
  scoreConfianza,
  etiquetaSecundaria,
  sustentoLegal,
  sustentoLabel,
  titulo = "Subpartida propuesta",
}: ClassificationHeroProps) {
  const etiqueta = etiquetaSecundaria ?? (confianza ? ETIQUETA_CONFIANZA[confianza] : undefined);
  const variante = confianza ? COLOR_POR_CONFIANZA[confianza] : "neutral";

  return (
    <Card>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-texto-secundario">{titulo}</span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1">
              <span className="font-mono text-[34px] leading-none font-semibold tracking-tight text-texto">
                {subpartida}
              </span>
              <CopiarCodigo codigo={subpartida} />
            </span>
            {etiqueta && <Badge variant={variante}>{etiqueta}</Badge>}
          </div>
        </div>

        <PartidaOficial subpartida={subpartida} />

        {scoreConfianza !== undefined && confianza && (
          <MedidorConfianza score={scoreConfianza} nivel={confianza} />
        )}

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

/** Solo dígitos: el arancel guarda "8471.30.00.00" y no se quiere que una
 * diferencia de puntos/espacios en la propuesta impida reconocer la fila. */
function normalizarCodigo(codigo: string) {
  return codigo.replace(/\D/g, "");
}

/**
 * Descripción oficial + ad valorem de la subpartida, leídos del Arancel
 * Nacional cargado (`partidas_arancelarias`). Buscar por código hace una
 * búsqueda por prefijo en el backend, así que se toma solo la coincidencia
 * EXACTA: si la propuesta no existe tal cual en el arancel (o la búsqueda
 * falla), se omite el bloque en vez de mostrar una partida vecina que
 * podría confundirse con la oficial.
 */
function PartidaOficial({ subpartida }: { subpartida: string }) {
  const { data, isLoading } = useBuscarArancel(subpartida);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1.5" aria-hidden="true">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  const buscado = normalizarCodigo(subpartida);
  const partida = data?.find((fila) => normalizarCodigo(fila.codigo) === buscado);
  if (!partida) return null;

  return (
    <div className="flex flex-col gap-1 border-l-2 border-surface-border pl-3">
      <p className="text-sm leading-relaxed text-texto">{partida.descripcion}</p>
      <p className="text-[13px] text-texto-secundario">
        Ad valorem:{" "}
        <span className="font-mono font-semibold text-texto">
          {partida.ad_valorem === null ? "no registrado" : `${partida.ad_valorem}%`}
        </span>
        <span className="ml-1.5">· Arancel Nacional</span>
      </p>
    </div>
  );
}

/** Barra de medición fina con el % de confianza. `role="meter"` (no
 * progressbar): es una medida estática, no el avance de una tarea. */
function MedidorConfianza({ score, nivel }: { score: number; nivel: NivelConfianza }) {
  const porcentaje = Math.round(Math.min(Math.max(score, 0), 1) * 100);

  return (
    <div className="flex max-w-sm items-center gap-3">
      <div
        role="meter"
        aria-label="Confianza de la propuesta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={porcentaje}
        aria-valuetext={`${porcentaje}%, ${ETIQUETA_CONFIANZA[nivel].toLowerCase()}`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-border"
      >
        <div className={cn("h-full rounded-full", RELLENO_POR_CONFIANZA[nivel])} style={{ width: `${porcentaje}%` }} />
      </div>
      <span className="font-mono text-[13px] font-semibold tabular-nums text-texto-secundario">{porcentaje}%</span>
    </div>
  );
}

/** Copia el código al portapapeles (para pegarlo en la DAM/SIGAD). Réplica
 * local del de ArancelPage -- es chico y no vale la pena sacarlo a ui/. */
function CopiarCodigo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const id = window.setTimeout(() => setCopiado(false), 1500);
    return () => window.clearTimeout(id);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      toast.error("No se pudo copiar el código.");
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={copiado ? "Código copiado" : `Copiar ${codigo}`}
      title={copiado ? "Copiado" : "Copiar código"}
      className="rounded p-1.5 text-texto-secundario transition-colors hover:bg-surface-border hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copiado ? <Check className="size-4 text-verde" /> : <Copy className="size-4" />}
    </button>
  );
}
