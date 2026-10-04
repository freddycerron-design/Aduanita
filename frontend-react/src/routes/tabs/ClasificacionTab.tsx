import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ClassificationHero } from "@/components/classification/ClassificationHero";
import { DecisionForm } from "@/components/classification/DecisionForm";
import { MissingInfoAlert } from "@/components/classification/MissingInfoAlert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useProfile } from "@/hooks/useProfile";
import { procesarInformacion } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { puedeDecidirClasificacion, puedeEnviarAClasificacion } from "@/lib/roles";
import type {
  DocumentoExtraidoOut,
  EstadoDespacho,
  HistorialClasificacionOut,
  PropuestaClasificacionOut,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ClasificacionTabProps {
  idDespacho: string;
  estadoDespacho: EstadoDespacho;
  documentos: DocumentoExtraidoOut[];
  /** Cache en memoria del backend -- puede venir null (recien enviado a
   * clasificacion y backend reiniciado, o despacho ya FINALIZADO). */
  clasificacion: PropuestaClasificacionOut | null;
  /** Decision ya persistida -- fuente de verdad para despachos FINALIZADOs,
   * fallback cuando `clasificacion` es null. */
  decision: HistorialClasificacionOut | null;
}

/**
 * Pestaña 2: propuesta de clasificación del clasificador IA + decisión del
 * liquidador. Ramas segun `estadoDespacho` + si ya existe `clasificacion`
 * en cache:
 *
 * - REVISION_DOC sin `clasificacion`: el despacho todavia no fue
 *   procesado, se apunta a la pestaña 1.
 * - REVISION_DOC con `clasificacion`: ya se presionó "Procesar
 *   información" pero todavía no "Enviar a Clasificación" -- vista previa
 *   de la propuesta (sin formulario de decisión: el liquidador recién
 *   decide una vez que el estado pasa a CLASIFICACION).
 * - FINALIZADO: la fuente de verdad es `decision` (persistida);
 *   `decision.tipo_accion` (APROBADO/EDITADO) reemplaza a lo que antes
 *   distinguía `estadoDespacho` (REVISADO/OBSERVADO) -- el estado del
 *   despacho ya no lleva ese detalle.
 * - CLASIFICACION: hero completo + alerta de informacion faltante +
 *   formulario de decision (gateado a rol LIQUIDADOR). Si `clasificacion`
 *   vino null (cache perdida, p.ej. reinicio del backend) se ofrece
 *   reintentar (gateado a rol GESTOR, misma accion que "Procesar
 *   informacion" en la pestaña 1).
 */
export function ClasificacionTab({
  idDespacho,
  estadoDespacho,
  documentos,
  clasificacion,
  decision,
}: ClasificacionTabProps) {
  const { data: perfil } = useProfile();
  const queryClient = useQueryClient();

  const reintentar = useMutation({
    mutationFn: () => procesarInformacion(idDespacho),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      toast.success("Propuesta de clasificación regenerada.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo regenerar la clasificación.");
    },
  });

  if (estadoDespacho === "REVISION_DOC" && clasificacion === null) {
    return (
      <Aviso tono="info">
        Este despacho aún no fue procesado. Carga los documentos y presiona "Extracción y validación" en la
        pestaña Revisión para generar la propuesta de clasificación.
      </Aviso>
    );
  }

  if (estadoDespacho === "REVISION_DOC" && clasificacion !== null) {
    return (
      <div className="flex flex-col gap-4">
        <ClassificationHero
          subpartida={clasificacion.subpartida_sugerida}
          confianza={clasificacion.nivel_confianza}
          scoreConfianza={clasificacion.score_confianza}
          sustentoLabel="Sustento legal (RGI):"
          sustentoLegal={clasificacion.sustento_legal_rgi}
        />
        <Aviso tono="info">
          Propuesta lista. Ve a la pestaña Revisión y presiona &quot;Enviar a clasificación&quot; para que el
          liquidador pueda decidir.
        </Aviso>
      </div>
    );
  }

  if (estadoDespacho === "FINALIZADO") {
    const aprobada = decision?.tipo_accion === "APROBADO";
    return (
      <div className="flex flex-col gap-4">
        {/* La decisión del liquidador es la fuente de verdad de un despacho
            cerrado; la propuesta de la IA (que ahora queda guardada) se
            muestra solo como referencia cuando el liquidador la cambió. */}
        {decision ? (
          <ClassificationHero
            subpartida={decision.subpartida_final_humano}
            confianza={aprobada ? "ALTA" : "BAJA"}
            etiquetaSecundaria={ETIQUETA_TIPO_ACCION[decision.tipo_accion]}
            titulo="Subpartida final"
            sustentoLegal={
              !aprobada && clasificacion && clasificacion.subpartida_sugerida !== decision.subpartida_final_humano
                ? `Decidida por el liquidador. La IA había propuesto ${clasificacion.subpartida_sugerida}.`
                : "Subpartida final decidida por el liquidador."
            }
          />
        ) : clasificacion ? (
          <ClassificationHero
            subpartida={clasificacion.subpartida_sugerida}
            confianza={clasificacion.nivel_confianza}
            scoreConfianza={clasificacion.score_confianza}
            sustentoLabel="Sustento legal (RGI):"
            sustentoLegal={clasificacion.sustento_legal_rgi}
          />
        ) : (
          <Aviso tono="info">No hay información de clasificación disponible para este despacho.</Aviso>
        )}

        {decision ? (
          aprobada ? (
            <Aviso tono="exito">Este despacho fue finalizado: el liquidador aceptó la propuesta tal cual.</Aviso>
          ) : (
            <Aviso tono="atencion">
              Este despacho fue finalizado con observaciones del liquidador.
              {decision.motivo_modificacion ? ` Motivo: ${decision.motivo_modificacion}` : ""}
            </Aviso>
          )
        ) : null}
      </div>
    );
  }

  // estadoDespacho === "CLASIFICACION" desde aqui en adelante.

  if (clasificacion === null) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tono="advertencia">
          Este despacho no tiene una propuesta de clasificación guardada (se envió a clasificación antes de que
          las propuestas se guardaran). Genera una nueva para continuar.
        </Aviso>
        {puedeEnviarAClasificacion(perfil?.rol) && (
          <div>
            <Button type="button" onClick={() => reintentar.mutate()} disabled={reintentar.isPending}>
              {reintentar.isPending ? "Generando..." : "Reintentar clasificación"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ClassificationHero
        subpartida={clasificacion.subpartida_sugerida}
        confianza={clasificacion.nivel_confianza}
        scoreConfianza={clasificacion.score_confianza}
        sustentoLabel="Sustento legal (RGI):"
        sustentoLegal={clasificacion.sustento_legal_rgi}
      />

      {clasificacion.informacion_faltante_alert.length > 0 && (
        <MissingInfoAlert items={clasificacion.informacion_faltante_alert} />
      )}

      <Separator />

      {puedeDecidirClasificacion(perfil?.rol) ? (
        <DecisionForm key={idDespacho} idDespacho={idDespacho} clasificacion={clasificacion} documentos={documentos} />
      ) : (
        <p className="text-sm text-texto-secundario">
          Solo un liquidador puede aceptar u observar esta clasificación.
        </p>
      )}
    </div>
  );
}

/** `tipo_accion` es un enum interno; en pantalla va en tipo oración. */
const ETIQUETA_TIPO_ACCION: Record<HistorialClasificacionOut["tipo_accion"], string> = {
  APROBADO: "Aprobado",
  EDITADO: "Editado",
};

const TONOS_AVISO = {
  info: "border-border bg-surface text-texto-secundario",
  exito: "border-verde/40 bg-verde/10 text-verde",
  advertencia: "border-amber/40 bg-amber/10 text-amber",
  atencion: "border-rojo/40 bg-rojo/10 text-rojo",
} as const;

/** Caja de aviso local a esta pestaña (equivalente a los `st.info` /
 * `st.success` / `st.warning` del dashboard viejo): verde=decision
 * aprobada, rojo=decision observada, amber=accion pendiente en
 * CLASIFICACION, info=neutro (aun sin propuesta o vista previa). */
function Aviso({ tono, children }: { tono: keyof typeof TONOS_AVISO; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm leading-relaxed", TONOS_AVISO[tono])}>
      {children}
    </div>
  );
}
