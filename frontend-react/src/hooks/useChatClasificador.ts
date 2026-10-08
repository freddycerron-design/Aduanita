import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { enviarMensajeClasificador } from "@/lib/api";
import type { AdjuntoChat, ClasificacionChat, ContextoChat, MensajeChat } from "@/lib/types";

/** Un mensaje tal como se muestra: además de lo que viaja al backend,
 * las opciones rápidas de una pregunta y la clasificación, si la hubo. */
export interface MensajeVisible extends MensajeChat {
  opciones?: string[];
  clasificacion?: ClasificacionChat | null;
}

const CONTEXTO_VACIO: ContextoChat = { terminos_busqueda: [], partidas_a_explorar: [] };

/** Texto con que un turno del asistente vuelve al modelo en el historial:
 * si clasificó, el código va explícito para que pueda seguir la charla
 * ("¿y si fuera integral?") sabiendo qué había propuesto. */
function textoParaHistorial(mensaje: MensajeVisible): string {
  if (mensaje.rol === "asistente" && mensaje.clasificacion) {
    return `${mensaje.texto}\n\n(Clasificación propuesta: ${mensaje.clasificacion.subpartida})`;
  }
  return mensaje.texto;
}

/**
 * Estado del chat "Clasificador con IA". El backend no guarda la
 * conversación: en cada turno se le manda completa (con los adjuntos)
 * junto con el `contexto` que devolvió el turno anterior. El estado vive
 * en la página (no en la pestaña) para no perder la charla al cambiar de
 * pestaña.
 */
export function useChatClasificador() {
  const [mensajes, setMensajes] = useState<MensajeVisible[]>([]);
  const [contexto, setContexto] = useState<ContextoChat>(CONTEXTO_VACIO);

  const turno = useMutation({
    mutationFn: ({ historial, contextoTurno }: { historial: MensajeVisible[]; contextoTurno: ContextoChat }) =>
      enviarMensajeClasificador(
        historial.map((m) => ({ rol: m.rol, texto: textoParaHistorial(m), adjunto: m.adjunto ?? null })),
        contextoTurno,
      ),
    onSuccess: (respuesta) => {
      setContexto(respuesta.contexto);
      setMensajes((previos) => [
        ...previos,
        {
          rol: "asistente",
          texto: respuesta.mensaje,
          opciones: respuesta.opciones,
          clasificacion: respuesta.clasificacion,
        },
      ]);
    },
  });

  function enviar(texto: string, adjunto: AdjuntoChat | null) {
    const nuevo: MensajeVisible = { rol: "usuario", texto: texto.trim(), adjunto };
    const historial = [...mensajes, nuevo];
    setMensajes(historial);
    turno.mutate({ historial, contextoTurno: contexto });
  }

  /** Reintenta el último turno fallido (el mensaje del usuario ya está). */
  function reintentar() {
    turno.mutate({ historial: mensajes, contextoTurno: contexto });
  }

  function reiniciar() {
    turno.reset();
    setMensajes([]);
    setContexto(CONTEXTO_VACIO);
  }

  return {
    mensajes,
    enviar,
    reintentar,
    reiniciar,
    pensando: turno.isPending,
    error: turno.error instanceof Error ? turno.error.message : turno.isError ? "No se pudo consultar la IA." : null,
  };
}

export type ChatClasificador = ReturnType<typeof useChatClasificador>;
