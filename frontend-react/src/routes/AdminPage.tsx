import { useState } from "react";
import { Plus, ShieldAlert } from "lucide-react";

import { useProfile } from "@/hooks/useProfile";
import { useReglasValidacion } from "@/hooks/useReglasValidacion";
import { esAdmin } from "@/lib/roles";
import type { ReglaValidacionOut } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReglaValidacionForm } from "@/components/admin/ReglaValidacionForm";
import { ReglasValidacionTable } from "@/components/admin/ReglasValidacionTable";

/**
 * Panel de administracion: CRUD de reglas de validacion (el motor
 * generico que reemplaza las 5 funciones hardcodeadas de
 * services/validation_engine.py). Gating inline como el resto del app
 * (sin guard de ruta por rol) -- si no es ADMIN, mensaje en vez de la
 * tabla.
 */
export function AdminPage() {
  const { data: perfil, isLoading: perfilCargando } = useProfile();
  const { data: reglas, isLoading: reglasCargando } = useReglasValidacion();
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [reglaEditando, setReglaEditando] = useState<ReglaValidacionOut | null>(null);

  if (perfilCargando) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!esAdmin(perfil?.rol)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <ShieldAlert className="size-10 text-texto-secundario" strokeWidth={1.5} />
        <p className="text-sm text-texto-secundario">
          No tienes permiso para ver esta página. Solo un administrador puede gestionar las reglas de
          validación.
        </p>
      </div>
    );
  }

  function abrirCrear() {
    setReglaEditando(null);
    setDialogoAbierto(true);
  }

  function abrirEditar(regla: ReglaValidacionOut) {
    setReglaEditando(regla);
    setDialogoAbierto(true);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-base font-semibold text-texto">Reglas de validación</h1>
          <p className="text-sm text-texto-secundario">
            Comparaciones cruzadas entre documentos que corren al procesar un despacho. Desactivar una
            regla la excluye sin borrarla.
          </p>
        </div>
        <Button type="button" onClick={abrirCrear}>
          <Plus className="size-4" />
          Nueva regla
        </Button>
      </div>

      {reglasCargando ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <ReglasValidacionTable reglas={reglas ?? []} onEditar={abrirEditar} />
      )}

      <ReglaValidacionForm open={dialogoAbierto} onOpenChange={setDialogoAbierto} regla={reglaEditando} />
    </div>
  );
}
