import { FolderOpen } from "lucide-react";

import logo from "@/assets/logo_aduafy.webp";
import { supabase } from "@/lib/supabase";
import { ESTADO_INFO } from "@/lib/estado";
import { formatearFecha } from "@/lib/fecha";
import { useAuthStore } from "@/hooks/useAuthStore";
import { usePortalDespachos } from "@/hooks/usePortalDespachos";
import { useProfile } from "@/hooks/useProfile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Portal del importador: superficie SEPARADA del sistema interno (no
 * comparte el layout ni la barra lateral del equipo). Muestra solo el
 * estado y las fechas de los despachos del cliente autenticado -- nunca
 * hallazgos de validación, clasificación, pre-liquidación ni documentos,
 * que son trabajo interno de la agencia.
 */
export function PortalPage() {
  const email = useAuthStore((state) => state.session?.user.email);
  const { data: perfil } = useProfile();
  const { data: despachos, isLoading, isError, error } = usePortalDespachos();

  return (
    <div className="flex h-dvh flex-col bg-background text-texto">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3">
        <div className="flex items-center gap-2.5">
          <img src={logo} alt="Aduafy" className="w-8" />
          <span className="text-sm font-bold">Aduafy</span>
          <span className="ml-2 hidden text-xs text-texto-secundario sm:inline">Portal del importador</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden truncate text-xs text-texto-secundario sm:inline">{email}</span>
          <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
            Cerrar sesión
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold text-texto">
              {perfil?.nombre_completo ? `Hola, ${perfil.nombre_completo}` : "Tus despachos"}
            </h1>
            <p className="mt-1 text-sm text-texto-secundario">
              Estado de tus operaciones en curso. Para cualquier detalle, tu agente de aduana es el
              contacto.
            </p>
          </div>

          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : isError ? (
            <p className="text-sm text-rojo">
              No se pudieron cargar tus despachos{error instanceof Error ? `: ${error.message}` : "."}
            </p>
          ) : !despachos || despachos.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center">
              <FolderOpen className="size-9 text-texto-secundario" strokeWidth={1.5} />
              <p className="text-sm text-texto-secundario">
                Todavía no hay despachos registrados a tu nombre.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Despacho</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead>Última actualización</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {despachos.map((despacho) => {
                  const info = ESTADO_INFO[despacho.estado];
                  return (
                    <TableRow key={despacho.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {despacho.numero_despacho}
                      </TableCell>
                      <TableCell>
                        <Badge variant={info.variant}>{info.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-texto-secundario">
                        {formatearFecha(despacho.fecha_creacion)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-texto-secundario">
                        {formatearFecha(despacho.actualizado_en)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </main>
    </div>
  );
}
