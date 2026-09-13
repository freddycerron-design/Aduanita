import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ClassificationHero } from "@/components/classification/ClassificationHero";
import { DecisionForm } from "@/components/classification/DecisionForm";
import { MissingInfoAlert } from "@/components/classification/MissingInfoAlert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useProfile } from "@/hooks/useProfile";
import { enviarAClasificacion } from "@/lib/api";
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
   * clasificacion y backend reiniciado, o despacho ya cerrado). */
  clasificacion: PropuestaClasificacionOut | null;
  /** Decision ya persistida -- fuente de verdad para despachos cerrados
   * (REVISADO/OBSERVADO), fallback cuando `clasificacion` es null. */
  decision: HistorialClasificacionOut | null;
}

/**
 * Pestaña 2: propuesta de clasificación del clasificador IA + decisión del
 * liquidador. Tres ramas segun `estadoDespacho`, replicando la logica de
 * `tab_clasificacion` en el dashboard.py viejo:
 *
 * - REVISION_DOC: el despacho todavia no tiene propuesta, se apunta a la
 *   pestaña 1.
 * - REVISADO / OBSERVADO: despacho cerrado -- la fuente de verdad es
 *   `decision` (persistida), `clasificacion` (cache en memoria del
 *   backend) se prefiere solo si por algun motivo vino no-null.
 * - CLASIFICACION: hero completo + alerta de informacion faltante +
 *   formulario de decision (gateado a rol LIQUIDADOR). Si `clasificacion`
 *   vino null (cache perdida, p.ej. reinicio del backend) se ofrece
 *   reintentar (gateado a rol ESPECIALISTA, misma accion que "Procesar
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
    mutationFn: () => enviarAClasificacion(idDespacho),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.despachos.detail(idDespacho) });
      toast.success("Propuesta de clasificación regenerada.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo regenerar la clasificación.");
    },
  });

  if (estadoDespacho === "REVISION_DOC") {
    return (
      <Aviso tono="info">
        Este despacho aún no fue procesado. Carga los documentos y presiona "Procesar información" en la
        pestaña Revisión para generar la propuesta de clasificación.
      </Aviso>
    );
  }

  if (estadoDespacho === "REVISADO" || estadoDespacho === "OBSERVADO") {
    return (
      <div className="flex flex-col gap-4">
        {clasificacion ? (
          <ClassificationHero
            subpartida={clasificacion.subpartida_sugerida}
            confianza={clasificacion.nivel_confianza}
            scoreConfianza={clasificacion.score_confianza}
            sustentoLabel="Sustento legal (RGI):"
            sustentoLegal={clasificacion.sustento_legal_rgi}
          />
        ) : decision ? (
          <ClassificationHero
            subpartida={decision.subpartida_final_humano}
            confianza={decision.tipo_accion === "APROBADO" ? "ALTA" : "BAJA"}
            etiquetaSecundaria={decision.tipo_accion}
            sustentoLegal="Subpartida final decidida por el liquidador."
          />
        ) : (
          <Aviso tono="info">No hay información de clasificación disponible para este despacho.</Aviso>
        )}

        {estadoDespacho === "REVISADO" ? (
          <Aviso tono="exito">
            Este despacho fue <strong>REVISADO</strong>: el liquidador aceptó la propuesta.
          </Aviso>
        ) : (
          <Aviso tono="atencion">
            Este despacho fue <strong>OBSERVADO</strong> por el liquidador.
            {decision?.motivo_modificacion ? ` Motivo: ${decision.motivo_modificacion}` : ""}
          </Aviso>
        )}
      </div>
    );
  }

  // estadoDespacho === "CLASIFICACION" desde aqui en adelante.

  if (clasificacion === null) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tono="advertencia">
          No se encontró la propuesta de clasificación en memoria (puede pasar si el backend se reinició).
          Vuelve a enviar el despacho a clasificación.
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

const TONOS_AVISO = {
  info: "border-border bg-surface text-texto-secundario",
  exito: "border-verde/40 bg-verde/10 text-verde",
  advertencia: "border-amber/40 bg-amber/10 text-amber",
  atencion: "border-rojo/40 bg-rojo/10 text-rojo",
} as const;

/** Caja de aviso local a esta pestaña (equivalente a los `st.info` /
 * `st.success` / `st.warning` del dashboard viejo), coloreada segun el
 * mismo mapeo semantico de estado que `ESTADO_INFO` (verde=REVISADO,
 * rojo=OBSERVADO, amber=accion pendiente en CLASIFICACION). */
function Aviso({ tono, children }: { tono: keyof typeof TONOS_AVISO; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm leading-relaxed", TONOS_AVISO[tono])}>
      {children}
    </div>
  );
}
