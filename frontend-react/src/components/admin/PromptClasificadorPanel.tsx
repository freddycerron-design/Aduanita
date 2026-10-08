import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { guardarPromptClasificador, obtenerPromptClasificador, restaurarPromptClasificador } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { SystemPromptOut } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/**
 * System prompt del chat "Clasificador con IA": las instrucciones con que
 * la IA actúa como liquidador (reglas de clasificación, cómo preguntar).
 * El listado de subpartidas del arancel lo agrega el sistema en cada turno
 * aparte de este texto, así que no hace falta incluirlo acá.
 */
export function PromptClasificadorPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.promptClasificador,
    queryFn: obtenerPromptClasificador,
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !data) return <p className="text-sm text-rojo">No se pudo cargar el prompt del clasificador.</p>;

  // key: al guardar o restaurar, el editor arranca del valor nuevo.
  return <EditorPrompt key={`${data.es_predeterminado}-${data.prompt.length}`} datos={data} />;
}

function EditorPrompt({ datos }: { datos: SystemPromptOut }) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState(datos.prompt);
  const cambiado = texto !== datos.prompt;

  const alTerminar = (actualizado: SystemPromptOut, mensaje: string) => {
    queryClient.setQueryData(queryKeys.promptClasificador, actualizado);
    toast.success(mensaje);
  };
  const guardar = useMutation({
    mutationFn: () => guardarPromptClasificador(texto),
    onSuccess: (r) => alTerminar(r, "Prompt guardado. Se usa desde la próxima pregunta del chat."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar el prompt."),
  });
  const restaurar = useMutation({
    mutationFn: restaurarPromptClasificador,
    onSuccess: (r) => alTerminar(r, "Se restauró el prompt predeterminado."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo restaurar el prompt."),
  });
  const ocupado = guardar.isPending || restaurar.isPending;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-[13px] text-texto-secundario">
          Instrucciones del chat <span className="text-texto">Clasificador con IA</span>: cómo actúa la IA (como un
          liquidador peruano), qué reglas de clasificación aplica y cómo pregunta. Las subpartidas del arancel se le
          agregan solas en cada turno.
        </p>
        <Badge variant={datos.es_predeterminado ? "neutral" : "amber"}>
          {datos.es_predeterminado ? "Predeterminado" : "Personalizado"}
        </Badge>
      </div>

      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={26}
        spellCheck={false}
        aria-label="System prompt del clasificador"
        className="font-mono text-[13px] leading-relaxed"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-texto-secundario">{texto.length.toLocaleString("es-PE")} caracteres</span>
        <div className="flex flex-wrap gap-2">
          {!datos.es_predeterminado && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (window.confirm("¿Volver al prompt predeterminado? Se pierde el texto personalizado.")) restaurar.mutate();
              }}
              disabled={ocupado}
            >
              {restaurar.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Restaurar predeterminado
            </Button>
          )}
          {cambiado && (
            <Button type="button" variant="outline" onClick={() => setTexto(datos.prompt)} disabled={ocupado}>
              Descartar cambios
            </Button>
          )}
          <Button type="button" onClick={() => guardar.mutate()} disabled={!cambiado || ocupado || texto.trim().length < 50}>
            {guardar.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
