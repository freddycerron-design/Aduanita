import { useRef } from "react";
import type { ChangeEvent } from "react";
import { CheckCircle2, FileText, Trash2, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DocumentoExtraidoOut, TipoDocumento } from "@/lib/types";
import { useEliminarDocumento } from "@/hooks/useEliminarDocumento";
import { useSubirDocumento } from "@/hooks/useSubirDocumento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DocumentUploadCardProps {
  idDespacho: string;
  tipo: TipoDocumento;
  documento: DocumentoExtraidoOut | undefined;
  /** Deshabilita subir/eliminar (p.ej. mientras "Procesar información"
   * esta en curso, para no cambiar documentos a mitad del pipeline). */
  disabled?: boolean;
}

/**
 * Tarjeta de carga para un tipo de documento. Acepta tanto PDF como fotos
 * (JPG/PNG/WEBP) del documento fisico -- el backend detecta el tipo real
 * del archivo por su contenido y elige la mejor estrategia de extraccion,
 * asi que aqui no hace falta distinguirlos. Subir es inmediato al elegir
 * el archivo (no hay boton "Confirmar"): el input nativo dispara
 * `onChange` una sola vez por seleccion real del usuario, asi que no hace
 * falta ningun mecanismo de deduplicacion (a diferencia del hack con
 * `file.file_id` que necesitaba la version Streamlit para evitar
 * re-subidas en cada rerun del script). Un archivo nuevo del mismo tipo
 * reemplaza al anterior automaticamente (el backend hace upsert).
 */
export function DocumentUploadCard({ idDespacho, tipo, documento, disabled }: DocumentUploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const subir = useSubirDocumento(idDespacho);
  const eliminar = useEliminarDocumento(idDespacho);

  const cargado = !!documento;
  const procesado = !!documento?.procesado;
  const ocupado = subir.isPending || eliminar.isPending;
  const controlesDeshabilitados = disabled || ocupado;

  function manejarSeleccion(evento: ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    // Se limpia el input ya mismo para poder volver a elegir el mismo
    // nombre de archivo mas adelante (el navegador no dispara "change" de
    // nuevo si el value sigue apuntando al mismo archivo).
    evento.target.value = "";
    if (archivo) subir.mutate({ tipoDocumento: tipo, archivo });
  }

  const Icono = procesado ? CheckCircle2 : FileText;
  const colorIcono = procesado ? "text-verde" : cargado ? "text-amber" : "text-texto-secundario";
  const etiquetaEstado = procesado ? "Procesado" : cargado ? "Cargado, pendiente de procesar" : "Sin cargar";
  const etiquetaBoton = subir.isPending
    ? "Subiendo..."
    : eliminar.isPending
      ? "Eliminando..."
      : cargado
        ? "Reemplazar archivo"
        : "Elegir PDF o foto";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Icono className={cn("size-4 shrink-0", colorIcono)} aria-hidden="true" />
          {tipo}
        </CardTitle>
        {cargado && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => eliminar.mutate(tipo)}
            disabled={controlesDeshabilitados}
            aria-label={`Eliminar ${tipo}`}
            title={`Eliminar ${tipo}`}
            className="text-rojo hover:bg-rojo/10 hover:text-rojo [&_svg]:size-5"
          >
            <Trash2 />
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-texto-secundario">{etiquetaEstado}</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={manejarSeleccion}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={controlesDeshabilitados}
          className="w-full"
        >
          <UploadCloud />
          {etiquetaBoton}
        </Button>
      </CardContent>
    </Card>
  );
}
