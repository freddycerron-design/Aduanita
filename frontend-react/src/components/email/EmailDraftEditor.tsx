import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useEditarBorrador } from "@/hooks/useEditarBorrador";
import type { BorradorCorreoOut, CanalEnvio } from "@/lib/types";

export interface EmailDraftEditorProps {
  borrador: BorradorCorreoOut;
  /** Despacho finalizado: canal y texto quedan fijos (se puede copiar). */
  soloLectura?: boolean;
}

const ETIQUETA_CANAL: Record<CanalEnvio, string> = {
  CORREO: "Correo",
  WHATSAPP: "WhatsApp",
  AMBOS: "Ambos",
};

/**
 * Editor del borrador generado por el pipeline: por qué canal se piensa
 * enviar (correo/WhatsApp/ambos) + el contenido editable. Nada de esto
 * envía nada de verdad -- el sistema no tiene integración de correo ni
 * de WhatsApp, sigue siendo un borrador que el especialista copia a su
 * cliente de correo o chat habitual. El canal es solo un registro de la
 * intención, útil para que el equipo sepa a simple vista qué falta
 * enviar y por dónde.
 *
 * El "Asunto" solo tiene sentido para un correo -- se oculta cuando el
 * canal elegido es WhatsApp puro (no cuando incluye Ambos, ahí sigue
 * siendo relevante para la mitad que sí es correo).
 *
 * El botón de guardar el cuerpo se habilita solo cuando el texto difiere
 * del último valor guardado; el canal, en cambio, se guarda solo al
 * cambiarlo (como un toggle, sin un botón de guardar aparte) porque es
 * una elección de una sola pieza, no texto que se pueda dejar a medio
 * escribir.
 */
export function EmailDraftEditor({ borrador, soloLectura = false }: EmailDraftEditorProps) {
  const valorInicial = borrador.cuerpo_editado ?? borrador.cuerpo;
  const [cuerpo, setCuerpo] = useState(valorInicial);
  const [ultimoGuardado, setUltimoGuardado] = useState(valorInicial);

  const editarBorrador = useEditarBorrador(borrador.id);
  const hayCambios = cuerpo !== ultimoGuardado;

  function handleGuardar() {
    editarBorrador.mutate(
      { cuerpo_editado: cuerpo },
      {
        onSuccess: () => {
          setUltimoGuardado(cuerpo);
          toast.success("Borrador actualizado.");
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "No se pudo guardar el borrador.");
        },
      },
    );
  }

  function handleCambiarCanal(valor: string) {
    const canal = valor as CanalEnvio;
    editarBorrador.mutate(
      { canal_envio: canal },
      {
        onSuccess: () => toast.success(`Canal actualizado a ${ETIQUETA_CANAL[canal]}.`),
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "No se pudo cambiar el canal.");
        },
      },
    );
  }

  const mostrarAsunto = borrador.canal_envio !== "WHATSAPP";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>¿Por dónde se va a enviar?</Label>
        <RadioGroup value={borrador.canal_envio} onValueChange={handleCambiarCanal}>
          <RadioGroupItem value="CORREO" disabled={soloLectura || editarBorrador.isPending}>
            Correo
          </RadioGroupItem>
          <RadioGroupItem value="WHATSAPP" disabled={soloLectura || editarBorrador.isPending}>
            WhatsApp
          </RadioGroupItem>
          <RadioGroupItem value="AMBOS" disabled={soloLectura || editarBorrador.isPending}>
            Ambos
          </RadioGroupItem>
        </RadioGroup>
        <p className="text-xs text-texto-secundario">
          Es solo un registro de la intención: nada se envía automáticamente por ningún canal.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border focus-within:ring-2 focus-within:ring-ring">
        {mostrarAsunto && (
          <div className="border-b-2 border-coral bg-surface px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-texto-secundario">Asunto</p>
            <p className="text-base font-semibold text-texto">{borrador.asunto}</p>
          </div>
        )}
        <Textarea
          value={cuerpo}
          onChange={(evento) => setCuerpo(evento.target.value)}
          readOnly={soloLectura}
          rows={14}
          className="min-h-80 resize-y rounded-none border-0 leading-relaxed focus-visible:ring-0"
        />
      </div>

      <p className="text-xs text-texto-secundario">
        Este mensaje no se envía automáticamente: cópialo y envíalo desde tu correo o WhatsApp habitual.
      </p>

      {!soloLectura && (
        <div>
          <Button type="button" onClick={handleGuardar} disabled={!hayCambios || editarBorrador.isPending}>
            {editarBorrador.isPending ? "Guardando..." : "Guardar edición del borrador"}
          </Button>
        </div>
      )}
    </div>
  );
}
