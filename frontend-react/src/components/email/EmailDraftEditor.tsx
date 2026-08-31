import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEditarBorrador } from "@/hooks/useEditarBorrador";
import type { BorradorCorreoOut } from "@/lib/types";

export interface EmailDraftEditorProps {
  borrador: BorradorCorreoOut;
}

/**
 * Editor del borrador de correo generado por el pipeline: encabezado tipo
 * "carta" con el asunto + cuerpo editable. El correo nunca se envia desde
 * aqui -- solo se persiste la edicion (PATCH /borradores/{id}) para que el
 * especialista lo copie a su cliente de correo habitual.
 *
 * El boton de guardar se habilita solo cuando el texto difiere del ultimo
 * valor guardado (mejora sobre la version Streamlit, que no distinguia
 * este caso).
 */
export function EmailDraftEditor({ borrador }: EmailDraftEditorProps) {
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

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border focus-within:ring-2 focus-within:ring-ring">
        <div className="border-b-2 border-coral bg-surface px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-texto-secundario">Asunto</p>
          <p className="text-base font-semibold text-texto">{borrador.asunto}</p>
        </div>
        <Textarea
          value={cuerpo}
          onChange={(evento) => setCuerpo(evento.target.value)}
          rows={14}
          className="min-h-80 resize-y rounded-none border-0 leading-relaxed focus-visible:ring-0"
        />
      </div>

      <p className="text-xs text-texto-secundario">
        Este correo no se envía automáticamente: cópialo y envíalo desde tu cliente de correo habitual.
      </p>

      <div>
        <Button type="button" onClick={handleGuardar} disabled={!hayCambios || editarBorrador.isPending}>
          {editarBorrador.isPending ? "Guardando..." : "Guardar edición del borrador"}
        </Button>
      </div>
    </div>
  );
}
