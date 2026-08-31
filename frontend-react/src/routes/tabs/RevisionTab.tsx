import { Loader2 } from "lucide-react";

import { puedeEnviarAClasificacion } from "@/lib/roles";
import { TIPOS_DOCUMENTO } from "@/lib/types";
import type { DocumentoExtraidoOut, EstadoDespacho, ResultadoValidacionOut, TipoDocumento } from "@/lib/types";
import { useProfile } from "@/hooks/useProfile";
import { useEnviarAClasificacion } from "@/hooks/useEnviarAClasificacion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentUploadCard } from "@/components/documents/DocumentUploadCard";
import { DocumentViewer } from "@/components/documents/DocumentViewer";
import { LedgerRow } from "@/components/validations/LedgerRow";

export interface RevisionTabProps {
  idDespacho: string;
  estadoDespacho: EstadoDespacho;
  documentos: DocumentoExtraidoOut[];
  validaciones: ResultadoValidacionOut[];
  /** Llamar tras un "Procesar información" exitoso (POST
   * enviar-a-clasificacion) -- el padre invalida la query de detalle y
   * cambia automaticamente a la pestana de Clasificacion. */
  onProcesado: () => void;
}

/** Tipos que como minimo deben estar cargados (no hace falta que ya esten
 * `procesado`) para habilitar "Procesar información". Seguro y SWIFT son
 * opcionales. */
const DOCUMENTOS_MINIMOS: TipoDocumento[] = ["FACTURA", "BL"];

/**
 * Pestaña "Revisión": carga de documentos, boton de procesamiento en
 * bloque, discrepancias de validacion y visor JSON/PDF. Ver
 * frontend/dashboard.py (tab_revision, version Streamlit) para el
 * comportamiento original que esta pantalla reemplaza.
 */
export function RevisionTab({ idDespacho, estadoDespacho, documentos, validaciones, onProcesado }: RevisionTabProps) {
  const { data: perfil, isLoading: perfilCargando } = useProfile();
  const enviar = useEnviarAClasificacion(idDespacho);

  const minimosOk = DOCUMENTOS_MINIMOS.every((tipo) => documentos.some((d) => d.tipo_documento === tipo));
  const puedeProcesar = puedeEnviarAClasificacion(perfil?.rol);
  const esEstadoRevision = estadoDespacho === "REVISION_DOC";

  async function manejarProcesar() {
    try {
      await enviar.mutateAsync();
      onProcesado();
    } catch {
      // El hook ya notifico el error via toast; no hay nada mas que hacer aqui.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-texto">Documentos</h2>
          <p className="text-xs text-texto-secundario">
            Cargar solo sube el PDF (rápido, sin extraer datos todavía). Cuando termines, presiona &quot;Procesar
            información&quot; para extraer, validar y clasificar todo de una vez.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIPOS_DOCUMENTO.map((tipo) => (
            <DocumentUploadCard
              key={tipo}
              idDespacho={idDespacho}
              tipo={tipo}
              documento={documentos.find((d) => d.tipo_documento === tipo)}
              disabled={enviar.isPending}
            />
          ))}
        </div>

        {!esEstadoRevision ? (
          <p className="text-sm text-texto-secundario">
            Este despacho ya fue procesado (estado actual: {estadoDespacho}).
          </p>
        ) : perfilCargando ? (
          <Skeleton className="h-10 w-full" />
        ) : !puedeProcesar ? (
          <p className="text-sm text-texto-secundario">Solo un especialista puede procesar este despacho.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={manejarProcesar}
              disabled={!minimosOk || enviar.isPending}
              className="w-full"
            >
              {enviar.isPending && <Loader2 className="animate-spin" />}
              {enviar.isPending ? "Extrayendo datos, validando y clasificando..." : "Procesar información"}
            </Button>
            {!minimosOk && <p className="text-xs text-texto-secundario">Carga al menos Factura y BL primero.</p>}
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-texto">Discrepancias</h2>
        {!minimosOk ? (
          <Card>
            <CardContent className="pt-4 text-sm text-texto-secundario">
              Carga al menos Factura y BL para poder validar (Seguro y SWIFT son opcionales).
            </CardContent>
          </Card>
        ) : validaciones.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            Aún no se ha ejecutado la validación. Se genera al presionar &quot;Procesar información&quot;.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {validaciones.map((resultado, indice) => (
              <LedgerRow key={`${resultado.regla}-${indice}`} resultado={resultado} />
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-texto">Visor de documentos</h2>
        <DocumentViewer documentos={documentos} />
      </section>
    </div>
  );
}
