import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { puedeEnviarAClasificacion } from "@/lib/roles";
import { TIPOS_DOCUMENTO } from "@/lib/types";
import type {
  DocumentoExtraidoOut,
  EstadoDespacho,
  ResultadoValidacionOut,
  Severidad,
  TipoDocumento,
} from "@/lib/types";
import { useProfile } from "@/hooks/useProfile";
import { useProcesarInformacion } from "@/hooks/useProcesarInformacion";
import { useEnviarAClasificacion } from "@/hooks/useEnviarAClasificacion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentUploadCard } from "@/components/documents/DocumentUploadCard";
import { DocumentViewer } from "@/components/documents/DocumentViewer";
import { LedgerRow, SEVERIDAD_INFO } from "@/components/validations/LedgerRow";

export interface RevisionTabProps {
  idDespacho: string;
  estadoDespacho: EstadoDespacho;
  documentos: DocumentoExtraidoOut[];
  validaciones: ResultadoValidacionOut[];
  /** true si ya existe una propuesta de clasificacion en la cache del
   * backend (detalle.clasificacion !== null) -- habilita el botón "Enviar
   * a Clasificación", que de otro modo no tiene nada que enviar. */
  clasificacionLista: boolean;
  /** Llamar tras un "Extracción y validación" o "Enviar a Clasificación"
   * exitosos -- el padre invalida la query de detalle y cambia
   * automaticamente a la pestana de Clasificacion. */
  onProcesado: () => void;
}

/** Tipos que como minimo deben estar cargados (no hace falta que ya esten
 * `procesado`) para habilitar "Extracción y validación". Seguro y SWIFT son
 * opcionales. */
const DOCUMENTOS_MINIMOS: TipoDocumento[] = ["FACTURA", "BL"];

const TODAS_SEVERIDADES: Severidad[] = ["ALTA", "MEDIA", "NINGUNA"];

/** Orden de criticidad para la lista de hallazgos: ALTA primero, luego
 * MEDIA, luego NINGUNA. */
const ORDEN_SEVERIDAD: Record<Severidad, number> = { ALTA: 0, MEDIA: 1, NINGUNA: 2 };

/** Clases literales (no interpoladas) para que el escaner de Tailwind las
 * genere -- estilo de cada chip de filtro cuando esta activo, un color por
 * severidad igual al de `SEVERIDAD_INFO`. */
const FILTRO_ACTIVO_CLASES: Record<Severidad, string> = {
  ALTA: "border-rojo/40 bg-rojo/15 text-rojo",
  MEDIA: "border-amber/40 bg-amber/15 text-amber",
  NINGUNA: "border-verde/40 bg-verde/15 text-verde",
};

/**
 * Pestaña "Revisión": carga de documentos, boton de procesamiento en
 * bloque, discrepancias de validacion y visor JSON/PDF. Ver
 * frontend/dashboard.py (tab_revision, version Streamlit) para el
 * comportamiento original que esta pantalla reemplaza.
 */
export function RevisionTab({
  idDespacho,
  estadoDespacho,
  documentos,
  validaciones,
  clasificacionLista,
  onProcesado,
}: RevisionTabProps) {
  const { data: perfil, isLoading: perfilCargando } = useProfile();
  const procesar = useProcesarInformacion(idDespacho);
  const enviar = useEnviarAClasificacion(idDespacho);
  // Filtro de severidad de los hallazgos -- arranca con las 3 activas (sin
  // filtrar). Desmarcar una severidad reduce la lista, lo que achica esta
  // seccion visualmente (no tiene un contenedor de altura fija ni scroll
  // propio, fluye en la misma pagina que el visor de abajo) y deja mas
  // espacio visible para el visor de documentos sin necesidad de scrollear.
  const [filtroSeveridad, setFiltroSeveridad] = useState<Severidad[]>(TODAS_SEVERIDADES);

  const minimosOk = DOCUMENTOS_MINIMOS.every((tipo) => documentos.some((d) => d.tipo_documento === tipo));
  // Independiente de que la extraccion se haya disparado recien ahora o
  // vengas a revisar un despacho ya procesado -- el aviso tiene sentido
  // en los dos casos, no solo en el instante en que termina "Extracción
  // y validación".
  const hayDatosExtraidos = documentos.some((d) => d.procesado);
  const puedeProcesar = puedeEnviarAClasificacion(perfil?.rol);
  const esEstadoRevision = estadoDespacho === "REVISION_DOC";
  const ocupado = procesar.isPending || enviar.isPending;
  const validacionesFiltradas = validaciones
    .filter((v) => filtroSeveridad.includes(v.severidad))
    .sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad]);

  function alternarFiltroSeveridad(severidad: Severidad) {
    setFiltroSeveridad((actual) =>
      actual.includes(severidad) ? actual.filter((s) => s !== severidad) : [...actual, severidad],
    );
  }

  async function manejarProcesar() {
    try {
      await procesar.mutateAsync();
      onProcesado();
    } catch {
      // El hook ya notifico el error via toast; no hay nada mas que hacer aqui.
    }
  }

  async function manejarEnviar() {
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
            Cargar solo sube el archivo, PDF o foto (rápido, sin extraer datos todavía). Cuando termines, presiona
            &quot;Extracción y validación&quot; para extraer, validar y clasificar todo de una vez.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {TIPOS_DOCUMENTO.map((tipo) => (
            <DocumentUploadCard
              key={tipo}
              idDespacho={idDespacho}
              tipo={tipo}
              documento={documentos.find((d) => d.tipo_documento === tipo)}
              disabled={ocupado}
            />
          ))}
        </div>

        {!esEstadoRevision ? (
          <p className="text-sm text-texto-secundario">
            Este despacho ya fue enviado a clasificación (estado actual: {estadoDespacho}).
          </p>
        ) : perfilCargando ? (
          <Skeleton className="h-10 w-full" />
        ) : !puedeProcesar ? (
          <p className="text-sm text-texto-secundario">Solo un especialista puede procesar este despacho.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={manejarProcesar} disabled={!minimosOk || ocupado}>
                {procesar.isPending && <Loader2 className="animate-spin" />}
                {procesar.isPending ? "Extrayendo datos, validando y clasificando..." : "Extracción y validación"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={manejarEnviar}
                disabled={!clasificacionLista || ocupado}
              >
                {enviar.isPending && <Loader2 className="animate-spin" />}
                {enviar.isPending ? "Enviando..." : "Enviar a Clasificación"}
              </Button>
            </div>
            {!minimosOk && <p className="text-xs text-texto-secundario">Carga al menos Factura y BL primero.</p>}
            {minimosOk && !clasificacionLista && (
              <p className="text-xs text-texto-secundario">
                Presiona &quot;Extracción y validación&quot; primero para generar la propuesta de clasificación.
              </p>
            )}
          </div>
        )}

        {hayDatosExtraidos && (
          <div className="flex items-start gap-2 rounded-lg border border-amber/40 bg-amber/10 p-3 text-xs text-amber">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              Estos datos los extrajo una inteligencia artificial y puede haberse equivocado. Revísalos con
              cuidado antes de usarlos en una declaración, en contabilidad o en cualquier otro trámite aduanero
              -- Aduafy no se hace responsable por errores en los documentos que generes con esta información.
            </p>
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-texto">Hallazgos de la revisión</h2>
          {validaciones.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {TODAS_SEVERIDADES.map((severidad) => {
                const { Icono } = SEVERIDAD_INFO[severidad];
                const cantidad = validaciones.filter((v) => v.severidad === severidad).length;
                const activo = filtroSeveridad.includes(severidad);
                return (
                  <button
                    key={severidad}
                    type="button"
                    onClick={() => alternarFiltroSeveridad(severidad)}
                    aria-pressed={activo}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
                      activo
                        ? FILTRO_ACTIVO_CLASES[severidad]
                        : "border-border bg-surface text-texto-secundario opacity-60 hover:opacity-100",
                    )}
                  >
                    <Icono className="size-3.5" />
                    {severidad} ({cantidad})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!minimosOk ? (
          <Card>
            <CardContent className="pt-4 text-sm text-texto-secundario">
              Carga al menos Factura y BL para poder validar (Seguro y SWIFT son opcionales).
            </CardContent>
          </Card>
        ) : validaciones.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            Aún no se ha ejecutado la validación. Se genera al presionar &quot;Extracción y validación&quot;.
          </p>
        ) : validacionesFiltradas.length === 0 ? (
          <p className="text-sm text-texto-secundario">No hay hallazgos con los filtros seleccionados.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {validacionesFiltradas.map((resultado, indice) => (
              <LedgerRow key={`${resultado.regla}-${indice}`} resultado={resultado} />
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-texto">Visor de documentos</h2>
        <DocumentViewer
          idDespacho={idDespacho}
          estadoDespacho={estadoDespacho}
          documentos={documentos}
        />
      </section>
    </div>
  );
}
