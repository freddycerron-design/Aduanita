import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Check,
  Copy,
  Crosshair,
  FileText,
  Route,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";

import { enviarFeedbackClasificador } from "@/lib/api";
import type { ClasificacionChat, NivelConfianza, SubpartidaArancelaria } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const CONFIANZA: Record<NivelConfianza, { etiqueta: string; variante: NonNullable<BadgeProps["variant"]> }> = {
  ALTA: { etiqueta: "Confianza alta", variante: "verde" },
  MEDIA: { etiqueta: "Confianza media", variante: "amber" },
  BAJA: { etiqueta: "Confianza baja", variante: "rojo" },
};

/** La descripción oficial junta los niveles con " - " ("Arroz. - Arroz
 * semiblanqueado... - - Los demás"): se muestra como ruta. */
function rutaDeDescripcion(descripcion: string): string[] {
  return descripcion
    .split(/\s+-(?:\s*-)*\s+/)
    .map((parte) => parte.trim().replace(/:$/, ""))
    .filter(Boolean);
}

export interface ResultadoClasificacionIAProps {
  clasificacion: ClasificacionChat;
  /** Texto de la conversación, para guardarlo con el feedback. */
  conversacion: { rol: "usuario" | "asistente"; texto: string }[];
  onVerFicha: (partida: SubpartidaArancelaria) => void;
}

/**
 * Resultado del chat Clasificador con IA: subpartida propuesta, su
 * ubicación en el arancel, los tributos vigentes de SUNAT, la
 * justificación (con las subpartidas descartadas) y el "¿te sirvió?".
 */
export function ResultadoClasificacionIA({ clasificacion, conversacion, onVerFicha }: ResultadoClasificacionIAProps) {
  const confianza = CONFIANZA[clasificacion.nivel_confianza];
  const ruta = clasificacion.descripcion_oficial ? rutaDeDescripcion(clasificacion.descripcion_oficial) : [];

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-xl border border-coral/50 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-texto">
            <Crosshair className="size-4 text-coral" aria-hidden="true" />
            Clasificación sugerida
          </h3>
          <Badge variant={confianza.variante} title={`${Math.round(clasificacion.score_confianza * 100)}%`}>
            {confianza.etiqueta}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-bg px-4 py-2 font-mono text-2xl font-bold tracking-tight text-texto">
            {clasificacion.subpartida}
          </span>
          <BotonCopiar codigo={clasificacion.subpartida} />
          {clasificacion.existe_en_arancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onVerFicha({
                  codigo: clasificacion.subpartida,
                  descripcion: clasificacion.descripcion_oficial ?? "",
                  // Sin ad valorem local: los tributos de arriba ya son los
                  // vigentes de SUNAT, no hay nada que comparar.
                  ad_valorem: null,
                  rank: 0,
                })
              }
              title="Ubicación en el arancel, gravámenes y otros requisitos en SUNAT"
            >
              <BookOpen />
              Ficha SUNAT
            </Button>
          )}
        </div>

        <p className="text-base font-medium text-texto">{clasificacion.titulo}</p>
        {ruta.length > 0 && (
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-texto-secundario">
            <Route className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{ruta.join(" › ")}</span>
          </p>
        )}
        {!clasificacion.existe_en_arancel && (
          <p className="flex items-start gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[13px] text-amber">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Este código no figura en el arancel cargado en Aduafy. Verifícalo antes de usarlo.
          </p>
        )}
      </section>

      {clasificacion.tributos.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-texto">
            <Calculator className="size-4 text-texto-secundario" aria-hidden="true" />
            Tributos aplicables
            <span className="text-xs font-normal text-texto-secundario">
              {clasificacion.fuente_tributos === "SUNAT" ? "vigentes en SUNAT" : "arancel 2022 (SUNAT no respondió)"}
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {clasificacion.tributos.map((tributo) => (
              <div key={tributo.concepto} className="flex flex-col items-center gap-1 rounded-lg border border-border bg-bg px-3 py-4">
                <span className="text-xs font-semibold text-texto-secundario">{tributo.concepto}</span>
                <span className="text-2xl font-bold tabular-nums text-texto">{tributo.valor}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-texto">
          <FileText className="size-4 text-texto-secundario" aria-hidden="true" />
          Justificación
        </h3>
        <p className="text-[15px] leading-relaxed text-texto">{clasificacion.justificacion}</p>
        {clasificacion.descartadas.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-[13px] font-semibold text-texto-secundario">Subpartidas descartadas</span>
            <ul className="flex flex-col gap-1.5">
              {clasificacion.descartadas.map((d) => (
                <li key={d.subpartida} className="text-[13px] leading-relaxed text-texto-secundario">
                  <span className="font-mono font-semibold text-texto">{d.subpartida}</span> — {d.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Feedback clasificacion={clasificacion} conversacion={conversacion} />
    </div>
  );
}

function BotonCopiar({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const id = window.setTimeout(() => setCopiado(false), 1500);
    return () => window.clearTimeout(id);
  }, [copiado]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(codigo);
          setCopiado(true);
        } catch {
          toast.error("No se pudo copiar el código.");
        }
      }}
    >
      {copiado ? <Check className="text-verde" /> : <Copy />}
      {copiado ? "Copiado" : "Copiar"}
    </Button>
  );
}

function Feedback({
  clasificacion,
  conversacion,
}: {
  clasificacion: ClasificacionChat;
  conversacion: { rol: "usuario" | "asistente"; texto: string }[];
}) {
  const [respuesta, setRespuesta] = useState<"si" | "no" | null>(null);
  const [comentario, setComentario] = useState("");
  const enviar = useMutation({
    mutationFn: (util: boolean) =>
      enviarFeedbackClasificador({
        subpartida: clasificacion.subpartida,
        nivel_confianza: clasificacion.nivel_confianza,
        util,
        comentario: comentario.trim() || null,
        conversacion,
      }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar tu respuesta."),
  });

  if (enviar.isSuccess) {
    return (
      <p className="rounded-xl border border-border bg-surface px-5 py-4 text-center text-sm text-texto-secundario">
        Gracias, tu respuesta nos ayuda a mejorar el clasificador.
      </p>
    );
  }

  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-5 py-5 text-center">
      <div>
        <h3 className="text-sm font-semibold text-texto">¿Te sirvió esta clasificación?</h3>
        <p className="text-[13px] text-texto-secundario">Tu respuesta nos ayuda a mejorar el clasificador.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setRespuesta("si");
            enviar.mutate(true);
          }}
          disabled={enviar.isPending}
        >
          <ThumbsUp className="text-verde" />
          Sí, es correcta
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setRespuesta("no")}
          disabled={enviar.isPending}
          className={cn(respuesta === "no" && "border-rojo/50")}
        >
          <ThumbsDown className="text-rojo" />
          No, es incorrecta
        </Button>
      </div>
      {respuesta === "no" && (
        <div className="flex w-full max-w-lg flex-col gap-2">
          <Textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={3}
            placeholder="¿Cuál sería la subpartida correcta o qué falló? (opcional)"
            aria-label="Comentario sobre la clasificación"
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={() => enviar.mutate(false)} disabled={enviar.isPending}>
              Enviar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
