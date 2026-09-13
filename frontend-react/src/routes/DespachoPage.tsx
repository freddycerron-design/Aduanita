import { useParams, useSearchParams } from "react-router-dom";

import { useDespachoDetalle } from "@/hooks/useDespachoDetalle";
import { DespachoHeader } from "@/components/layout/DespachoHeader";
import { ExportarDespachoBotones } from "@/components/despacho/ExportarDespachoBotones";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RevisionTab } from "@/routes/tabs/RevisionTab";
import { ClasificacionTab } from "@/routes/tabs/ClasificacionTab";
import { CorreoTab } from "@/routes/tabs/CorreoTab";

type TabValue = "revision" | "clasificacion" | "correo";
const TABS_VALIDOS: TabValue[] = ["revision", "clasificacion", "correo"];

/**
 * Shell del despacho activo: header + las 3 pestanas numeradas. El
 * contenido de cada pestana vive en un componente propio (routes/tabs/*)
 * para que el flujo de Revision, Clasificacion y Correo se puedan
 * desarrollar de forma independiente -- este archivo solo orquesta cual
 * esta visible (sincronizado con ?tab= en la URL, asi que un refresh no
 * pierde la pestana activa) y les pasa los datos ya cargados de
 * `useDespachoDetalle`.
 */
export function DespachoPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: detalle, isLoading, isError, error } = useDespachoDetalle(id);

  const tabParam = searchParams.get("tab");
  const tabActivo: TabValue = TABS_VALIDOS.includes(tabParam as TabValue) ? (tabParam as TabValue) : "revision";

  function irATab(tab: TabValue) {
    setSearchParams((prev) => {
      const siguiente = new URLSearchParams(prev);
      siguiente.set("tab", tab);
      return siguiente;
    });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !detalle) {
    return (
      <div className="p-6 text-sm text-rojo">
        No se pudo cargar el despacho{error instanceof Error ? `: ${error.message}` : "."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <DespachoHeader despacho={detalle.despacho}>
        <ExportarDespachoBotones detalle={detalle} />
      </DespachoHeader>
      <div className="flex-1 overflow-y-auto p-6">
        <Tabs value={tabActivo} onValueChange={(valor) => irATab(valor as TabValue)}>
          <TabsList>
            <TabsTrigger value="revision" numero={1}>
              Revisión
            </TabsTrigger>
            <TabsTrigger value="clasificacion" numero={2}>
              Clasificación
            </TabsTrigger>
            <TabsTrigger value="correo" numero={3}>
              Correo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="revision">
            <RevisionTab
              idDespacho={detalle.despacho.id}
              estadoDespacho={detalle.despacho.estado}
              documentos={detalle.documentos}
              validaciones={detalle.validaciones}
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

          <TabsContent value="correo">
            <CorreoTab borrador={detalle.borrador} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
