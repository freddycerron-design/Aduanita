import { useState } from "react";
import { Plus, ShieldAlert } from "lucide-react";

import { useProfile } from "@/hooks/useProfile";
import { useReglasValidacion } from "@/hooks/useReglasValidacion";
import { useCargosEspeciales } from "@/hooks/useCargosEspeciales";
import { esAdmin } from "@/lib/roles";
import type { CargoEspecialArancelOut, ReglaValidacionOut } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ReglaValidacionForm } from "@/components/admin/ReglaValidacionForm";
import { ReglasValidacionTable } from "@/components/admin/ReglasValidacionTable";
import { CargoEspecialForm } from "@/components/admin/CargoEspecialForm";
import { CargosEspecialesTable } from "@/components/admin/CargosEspecialesTable";

/**
 * Panel de administracion: CRUD de reglas de validacion (el motor
 * generico que reemplaza las 5 funciones hardcodeadas de
 * services/validation_engine.py) + CRUD de cargos especiales del arancel
 * (antidumping/derecho especifico por subpartida, usados como default en
 * la pestaña Pre-liquidación). Gating inline como el resto del app (sin
 * guard de ruta por rol) -- si no es ADMIN, mensaje en vez de las tablas.
 */
export function AdminPage() {
  const { data: perfil, isLoading: perfilCargando } = useProfile();
  const { data: reglas, isLoading: reglasCargando } = useReglasValidacion();
  const { data: cargos, isLoading: cargosCargando } = useCargosEspeciales();
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [reglaEditando, setReglaEditando] = useState<ReglaValidacionOut | null>(null);
  const [dialogoCargoAbierto, setDialogoCargoAbierto] = useState(false);
  const [cargoEditando, setCargoEditando] = useState<CargoEspecialArancelOut | null>(null);

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

  function abrirCrearCargo() {
    setCargoEditando(null);
    setDialogoCargoAbierto(true);
  }

  function abrirEditarCargo(cargo: CargoEspecialArancelOut) {
    setCargoEditando(cargo);
    setDialogoCargoAbierto(true);
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

      <Separator className="my-8" />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-base font-semibold text-texto">Cargos especiales del arancel</h1>
          <p className="text-sm text-texto-secundario">
            Tasas de antidumping y derecho específico por subpartida (no hay fuente oficial CSV/API para
            esto -- son resoluciones puntuales de INDECOPI/MEF). Se usan como valor sugerido al calcular la
            pre-liquidación de un despacho.
          </p>
        </div>
        <Button type="button" onClick={abrirCrearCargo}>
          <Plus className="size-4" />
          Nuevo cargo
        </Button>
      </div>

      {cargosCargando ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <CargosEspecialesTable cargos={cargos ?? []} onEditar={abrirEditarCargo} />
      )}

      <CargoEspecialForm open={dialogoCargoAbierto} onOpenChange={setDialogoCargoAbierto} cargo={cargoEditando} />
    </div>
  );
}
