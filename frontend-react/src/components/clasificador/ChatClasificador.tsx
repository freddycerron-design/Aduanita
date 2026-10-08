import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Loader2, Paperclip, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import type { ChatClasificador, MensajeVisible } from "@/hooks/useChatClasificador";
import type { AdjuntoChat, SubpartidaArancelaria } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ResultadoClasificacionIA } from "@/components/clasificador/ResultadoClasificacionIA";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_BYTES = 8 * 1024 * 1024;
const ACEPTADOS = "application/pdf,image/jpeg,image/png,image/webp";

const EJEMPLOS = [
  "Arroz blanco pulido en sacos de 50 kg",
  "Audífonos inalámbricos bluetooth",
  "Guantes de nitrilo descartables",
];

function leerComoBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",", 2)[1] ?? "");
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(archivo);
  });
}

export interface ChatClasificadorProps {
  chat: ChatClasificador;
  onVerFicha: (partida: SubpartidaArancelaria) => void;
}

/**
 * Chat de clasificación arancelaria: el usuario describe la mercancía
 * (texto, foto o documento) y la IA pregunta lo que falte hasta proponer
 * la subpartida. La lógica y el estado están en `useChatClasificador`.
 */
export function ChatClasificador({ chat, onVerFicha }: ChatClasificadorProps) {
  const [texto, setTexto] = useState("");
  const [adjunto, setAdjunto] = useState<AdjuntoChat | null>(null);
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const { mensajes, pensando, error } = chat;

  // Cada mensaje nuevo (o el "pensando") se trae a la vista.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes.length, pensando]);

  const ultimo = mensajes[mensajes.length - 1];
  const opcionesRapidas = !pensando && ultimo?.rol === "asistente" ? (ultimo.opciones ?? []) : [];
  const conversacionTexto = mensajes.map((m) => ({ rol: m.rol, texto: m.texto }));

  function enviar(textoAEnviar: string) {
    if (pensando || (!textoAEnviar.trim() && !adjunto)) return;
    chat.enviar(textoAEnviar, adjunto);
    setTexto("");
    setAdjunto(null);
  }

  function alEnviar(evento: FormEvent) {
    evento.preventDefault();
    enviar(texto);
  }

  function alTeclear(evento: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envía; Shift+Enter hace salto de línea.
    if (evento.key === "Enter" && !evento.shiftKey) {
      evento.preventDefault();
      enviar(texto);
    }
  }

  async function alElegirArchivo(evento: ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!archivo) return;
    if (archivo.size > MAX_BYTES) {
      toast.error("El archivo supera los 8 MB.");
      return;
    }
    try {
      setAdjunto({ nombre: archivo.name, contenido_base64: await leerComoBase64(archivo) });
    } catch {
      toast.error("No se pudo leer el archivo.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-[13px] text-texto-secundario">
          Describe la mercancía o adjunta una foto o ficha técnica. La IA te hará las preguntas que un liquidador
          necesita para proponer la subpartida nacional, aplicando las reglas de clasificación del Perú.
        </p>
        {mensajes.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={chat.reiniciar} disabled={pensando}>
            <RotateCcw />
            Nueva clasificación
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        {mensajes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Sparkles className="size-8 text-coral" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-sm text-texto">¿Qué mercancía quieres clasificar?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EJEMPLOS.map((ejemplo) => (
                <button
                  key={ejemplo}
                  type="button"
                  onClick={() => enviar(ejemplo)}
                  className="rounded-full border border-border px-3 py-1.5 text-[13px] text-texto-secundario transition-colors hover:border-coral/50 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ejemplo}
                </button>
              ))}
            </div>
          </div>
        ) : (
          mensajes.map((mensaje, indice) => (
            <Burbuja
              key={indice}
              mensaje={mensaje}
              conversacion={conversacionTexto.slice(0, indice + 1)}
              onVerFicha={onVerFicha}
            />
          ))
        )}

        {pensando && (
          <p className="flex items-center gap-2 self-start rounded-xl bg-bg px-4 py-2.5 text-sm text-texto-secundario">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Analizando la mercancía…
          </p>
        )}

        {error && !pensando && (
          <div className="flex flex-wrap items-center gap-3 self-start rounded-xl border border-rojo/40 bg-rojo/10 px-4 py-2.5 text-sm text-rojo">
            {error}
            <Button type="button" variant="outline" size="sm" onClick={chat.reintentar}>
              Reintentar
            </Button>
          </div>
        )}

        {opcionesRapidas.length > 0 && (
          <div className="flex flex-wrap gap-2 self-start">
            {opcionesRapidas.map((opcion) => (
              <button
                key={opcion}
                type="button"
                onClick={() => enviar(opcion)}
                className="rounded-full border border-coral/40 bg-coral/10 px-3 py-1.5 text-[13px] font-medium text-coral transition-colors hover:bg-coral/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {opcion}
              </button>
            ))}
          </div>
        )}
        <div ref={finRef} />
      </div>

      <form onSubmit={alEnviar} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
        {adjunto && (
          <span className="flex w-fit items-center gap-2 rounded-full bg-bg px-3 py-1 text-[13px] text-texto">
            <Paperclip className="size-3.5" aria-hidden="true" />
            {adjunto.nombre}
            <button
              type="button"
              onClick={() => setAdjunto(null)}
              aria-label="Quitar archivo"
              className="rounded text-texto-secundario hover:text-texto"
            >
              <X className="size-3.5" />
            </button>
          </span>
        )}
        <div className="flex items-end gap-2">
          <input ref={inputArchivoRef} type="file" accept={ACEPTADOS} className="hidden" onChange={alElegirArchivo} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => inputArchivoRef.current?.click()}
            disabled={pensando}
            aria-label="Adjuntar foto o documento"
            title="Adjuntar foto o documento (PDF, JPG, PNG, WEBP; máx. 8 MB)"
          >
            <Paperclip />
          </Button>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclear}
            rows={2}
            placeholder={mensajes.length === 0 ? "Describe la mercancía…" : "Escribe tu respuesta…"}
            aria-label="Mensaje para el clasificador"
            className="min-h-0 flex-1 resize-none bg-bg"
          />
          <Button type="submit" disabled={pensando || (!texto.trim() && !adjunto)} aria-label="Enviar">
            {pensando ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            Enviar
          </Button>
        </div>
      </form>
    </div>
  );
}

function Burbuja({
  mensaje,
  conversacion,
  onVerFicha,
}: {
  mensaje: MensajeVisible;
  conversacion: { rol: "usuario" | "asistente"; texto: string }[];
  onVerFicha: (partida: SubpartidaArancelaria) => void;
}) {
  const esUsuario = mensaje.rol === "usuario";
  return (
    <div className={cn("flex flex-col gap-3", esUsuario ? "items-end" : "items-start")}>
      {(mensaje.texto || mensaje.adjunto) && (
        <div
          className={cn(
            "flex max-w-[85%] flex-col gap-1.5 whitespace-pre-wrap rounded-xl px-4 py-2.5 text-[15px] leading-relaxed",
            esUsuario ? "bg-coral/15 text-texto" : "bg-bg text-texto",
          )}
        >
          {mensaje.adjunto && (
            <span className="flex items-center gap-1.5 text-[13px] text-texto-secundario">
              <Paperclip className="size-3.5" aria-hidden="true" />
              {mensaje.adjunto.nombre}
            </span>
          )}
          {mensaje.texto}
        </div>
      )}
      {mensaje.clasificacion && (
        <div className="w-full">
          <ResultadoClasificacionIA
            clasificacion={mensaje.clasificacion}
            conversacion={conversacion}
            onVerFicha={onVerFicha}
          />
        </div>
      )}
    </div>
  );
}
