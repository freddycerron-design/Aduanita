import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useRegistrarDecision } from "@/hooks/useRegistrarDecision";
import type {
  DecisionRequest,
  DocumentoExtraidoOut,
  FacturaContenido,
  PropuestaClasificacionOut,
} from "@/lib/types";

export interface DecisionFormProps {
  idDespacho: string;
  clasificacion: PropuestaClasificacionOut;
  documentos: DocumentoExtraidoOut[];
}

/**
 * Formulario de decision del liquidador sobre la propuesta de
 * clasificacion: aceptarla tal cual (REVISADO) u observarla con una
 * subpartida corregida + motivo obligatorio (OBSERVADO). Arma el
 * `DecisionRequest` con la misma logica que `tab_clasificacion` en el
 * dashboard.py viejo (descripcion_comercial/atributos salen del documento
 * FACTURA), re-expresada con componentes React.
 */
export function DecisionForm({ idDespacho, clasificacion, documentos }: DecisionFormProps) {
  const [accion, setAccion] = useState<DecisionRequest["accion"]>("REVISADO");
  const [subpartidaCorregida, setSubpartidaCorregida] = useState(clasificacion.subpartida_sugerida);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);

  const registrarDecision = useRegistrarDecision(idDespacho);

  function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    if (accion === "OBSERVADO" && motivo.trim() === "") {
      setErrorMotivo("Debes indicar el motivo de la observación.");
      return;
    }
    setErrorMotivo(null);

    const facturaDoc = documentos.find((documento) => documento.tipo_documento === "FACTURA");
    const facturaContenido = facturaDoc?.contenido_json as FacturaContenido | undefined;

    const payload: DecisionRequest = {
      accion,
      subpartida_sugerida_ia: clasificacion.subpartida_sugerida,
      subpartida_final: accion === "REVISADO" ? clasificacion.subpartida_sugerida : subpartidaCorregida,
      descripcion_comercial: facturaContenido?.descripcion_mercancia ?? "",
      atributos: { incoterm: facturaContenido?.incoterm ?? null },
      motivo_modificacion: accion === "OBSERVADO" ? motivo : undefined,
    };

    registrarDecision.mutate(payload, {
      onSuccess: () => {
        toast.success("Decision registrada. El RAG fue actualizado con este feedback.");
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "No se pudo registrar la decision.");
      },
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <h3 className="text-sm font-semibold text-texto">Decisión del liquidador</h3>

      <div className="flex flex-col gap-2">
        <Label>¿La propuesta es correcta?</Label>
        <RadioGroup
          value={accion}
          onValueChange={(valor) => setAccion(valor as DecisionRequest["accion"])}
        >
          <RadioGroupItem value="REVISADO">Revisión conforme</RadioGroupItem>
          <RadioGroupItem value="OBSERVADO">Observar</RadioGroupItem>
        </RadioGroup>
      </div>

      {accion === "OBSERVADO" && (
        <div className="flex flex-col gap-4 border-l-2 border-rojo/30 pl-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="subpartida-corregida">Subpartida corregida</Label>
            <Input
              id="subpartida-corregida"
              className="font-mono"
              value={subpartidaCorregida}
              onChange={(evento) => setSubpartidaCorregida(evento.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="motivo-observacion">Motivo de la observación (obligatorio)</Label>
            <Textarea
              id="motivo-observacion"
              rows={3}
              value={motivo}
              onChange={(evento) => {
                setMotivo(evento.target.value);
                if (errorMotivo) setErrorMotivo(null);
              }}
            />
            {errorMotivo && <p className="text-sm text-rojo">{errorMotivo}</p>}
          </div>
        </div>
      )}

      <div>
        <Button type="submit" disabled={registrarDecision.isPending}>
          {registrarDecision.isPending ? "Enviando..." : "Confirmar decisión"}
        </Button>
      </div>
    </form>
  );
}
