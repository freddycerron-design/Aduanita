import { Lock } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import { useDespachoDetalle } from "@/hooks/useDespachoDetalle";
import { DespachoHeader } from "@/components/layout/DespachoHeader";
import { ExportarDespachoBotones } from "@/components/despacho/ExportarDespachoBotones";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExploradorTab } from "@/routes/tabs/ExploradorTab";
import { RevisionTab } from "@/routes/tabs/RevisionTab";
import { ClasificacionTab } from "@/routes/tabs/ClasificacionTab";
import { PreliquidacionTab } from "@/routes/tabs/PreliquidacionTab";
import { ComunicacionesTab } from "@/routes/tabs/ComunicacionesTab";

type TabValue = "explorador" | "revision" | "clasificacion" | "preliquidacion" | "comunicaciones";
const TABS_VALIDOS: TabValue[] = ["explorador", "revision", "clasificacion", "preliquidacion", "comunicaciones"];

/**
 * Shell de la sección Validador: el Explorador (crear/buscar/listar
 * despachos, ver `ExploradorTab`) es la primera pestaña de la MISMA tira
 * que Revisión/Preclasificación/Preliquidación/Comunicaciones (antes
 * "Correo": ahora el borrador puede marcarse para enviarse por correo,
 * WhatsApp, o ambos, ver `ComunicacionesTab`) -- ya no un panel lateral
 * aparte. No hay un despacho "activo" hasta que se elige uno ahí (o se
 * crea uno nuevo), momento en el que la URL pasa a `/despachos/:id`.
 *
 * Sin id (ruta `/despachos`): el Explorador es la única pestaña
 * habilitada -- las demás no tienen sentido sin un despacho elegido, así
 * que se deshabilitan en vez de ocultarse (para que el usuario vea que
 * existen y por qué no puede entrar todavía).
 *
 * Con id (`/despachos/:id`): las 5 pestañas están disponibles. Revisión
 * es la inicial salvo que la URL ya diga otra cosa (`?tab=`, como pone
 * `onProcesado` al enviar a clasificación); el Explorador sigue ahí para
 * volver al listado o abrir otro despacho sin perder de vista el actual.
 */
export function DespachoPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: detalle, isLoading, isError, error } = useDespachoDetalle(id);

  const tabPorDefecto: TabValue = id ? "revision" : "explorador";
  const tabParam = searchParams.get("tab");
  const tabActivo: TabValue = TABS_VALIDOS.includes(tabParam as TabValue) ? (tabParam as TabValue) : tabPorDefecto;

  function irATab(tab: TabValue) {
    setSearchParams((prev) => {
      const siguiente = new URLSearchParams(prev);
      siguiente.set("tab", tab);
      return siguiente;
    });
  }

  // Estas dos solo aplican cuando SÍ hay un id en la URL: sin él,
  // `useDespachoDetalle` queda deshabilitada (`enabled: !!id`) y nunca
  // esta en isLoading/isError -- el Explorador no depende de ningun
  // despacho puntual.
  if (id && isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (id && (isError || !detalle)) {
    return (
      <div className="p-6 text-sm text-rojo">
        No se pudo cargar el despacho{error instanceof Error ? `: ${error.message}` : "."}
      </div>
    );
  }

  // Un despacho cerrado es de solo lectura (el backend responde 409 a
  // cualquier modificacion, ver _exigir_despacho_editable): acá solo se
  // ocultan o desactivan las acciones para no ofrecer algo que va a fallar.
  const finalizado = detalle?.despacho.estado === "FINALIZADO";

  return (
    <div className="flex h-full flex-col">
      {detalle ? (
        <DespachoHeader detalle={detalle}>
          <ExportarDespachoBotones detalle={detalle} />
        </DespachoHeader>
      ) : (
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-lg font-semibold text-texto">Validador</h1>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-6">
        {finalizado && (
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-[13px] text-texto-secundario">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            Despacho finalizado: puedes consultarlo y exportarlo, pero ya no se puede modificar.
          </p>
        )}
        <Tabs value={tabActivo} onValueChange={(valor) => irATab(valor as TabValue)}>
          <TabsList>
            <TabsTrigger value="explorador">Explorador</TabsTrigger>
            <TabsTrigger value="revision" disabled={!detalle}>
              Revisión
            </TabsTrigger>
            <TabsTrigger value="clasificacion" disabled={!detalle}>
              Preclasificación
            </TabsTrigger>
            <TabsTrigger value="preliquidacion" disabled={!detalle}>
              Preliquidación
            </TabsTrigger>
            <TabsTrigger value="comunicaciones" disabled={!detalle}>
              Comunicaciones
            </TabsTrigger>
          </TabsList>

          <TabsContent value="explorador">
            <ExploradorTab />
          </TabsContent>

          {detalle && (
            <>
              <TabsContent value="revision">
                <RevisionTab
                  idDespacho={detalle.despacho.id}
                  estadoDespacho={detalle.despacho.estado}
                  documentos={detalle.documentos}
                  validaciones={detalle.validaciones}
                  clasificacionLista={detalle.clasificacion !== null}
                  onProcesado={() => irATab("clasificacion")}
                />
              </TabsContent>

              <TabsContent value="clasificacion">
                <ClasificacionTab
                  idDespacho={detalle.despacho.id}
                  estadoDespacho={detalle.despacho.estado}
                  documentos={detalle.documentos}
                  clasificacion={detalle.clasificacion}
                  decision={detalle.decision}
                />
              </TabsContent>

              <TabsContent value="preliquidacion">
                <PreliquidacionTab
                  idDespacho={detalle.despacho.id}
                  documentos={detalle.documentos}
                  soloLectura={finalizado}
                />
              </TabsContent>

              <TabsContent value="comunicaciones">
                <ComunicacionesTab borrador={detalle.borrador} soloLectura={finalizado} />
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </div>
  );
}
