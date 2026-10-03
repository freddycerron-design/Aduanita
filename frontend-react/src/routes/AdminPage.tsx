import { useState } from "react";
import type { ReactNode } from "react";
import { Plus, ShieldAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { useProfile } from "@/hooks/useProfile";
import { useReglasValidacion } from "@/hooks/useReglasValidacion";
import { useCargosEspeciales } from "@/hooks/useCargosEspeciales";
import { useUsuarios } from "@/hooks/useUsuarios";
import { useClientes } from "@/hooks/useClientes";
import { esAdmin } from "@/lib/roles";
import type { CargoEspecialArancelOut, ClienteOut, ReglaValidacionOut, UsuarioOut } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReglaValidacionForm } from "@/components/admin/ReglaValidacionForm";
import { ReglasValidacionTable } from "@/components/admin/ReglasValidacionTable";
import { CargoEspecialForm } from "@/components/admin/CargoEspecialForm";
import { CargosEspecialesTable } from "@/components/admin/CargosEspecialesTable";
import { UsuarioForm } from "@/components/admin/UsuarioForm";
import { UsuariosTable } from "@/components/admin/UsuariosTable";
import { ClienteForm } from "@/components/admin/ClienteForm";
import { ClientesTable } from "@/components/admin/ClientesTable";
import { DatosDocumentosPanel } from "@/components/admin/DatosDocumentosPanel";

/** Orden de las pestañas: primero el "quién" (cuentas del equipo e
 * importadores), después el "cómo" (reglas de negocio que configuran el
 * comportamiento del sistema). */
type PestanaAdmin = "usuarios" | "importadores" | "reglas" | "datos-documentos" | "cargos";
const PESTANAS_VALIDAS: PestanaAdmin[] = ["usuarios", "importadores", "reglas", "datos-documentos", "cargos"];

/**
 * Panel de administracion, una pestaña por mantenimiento (antes las
 * cuatro tablas iban apiladas una debajo de otra y cada una quedaba con
 * poco espacio): usuarios y roles, importadores, reglas de validacion
 * (el motor generico de validation_engine.py) y cargos especiales del
 * arancel (antidumping/derecho especifico, default de la Pre-liquidacion).
 *
 * La pestaña activa vive en `?tab=` (mismo patron que DespachoPage), asi
 * que un refresh no te devuelve a la primera. Gating inline como el resto
 * del app (sin guard de ruta por rol) -- si no es ADMIN, mensaje en vez
 * de las tablas.
 */
export function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: perfil, isLoading: perfilCargando } = useProfile();
  const { data: reglas, isLoading: reglasCargando } = useReglasValidacion();
  const { data: cargos, isLoading: cargosCargando } = useCargosEspeciales();
  const { data: usuarios, isLoading: usuariosCargando } = useUsuarios();
  const { data: clientes, isLoading: clientesCargando } = useClientes();
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [reglaEditando, setReglaEditando] = useState<ReglaValidacionOut | null>(null);
  const [dialogoCargoAbierto, setDialogoCargoAbierto] = useState(false);
  const [cargoEditando, setCargoEditando] = useState<CargoEspecialArancelOut | null>(null);
  const [dialogoUsuarioAbierto, setDialogoUsuarioAbierto] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<UsuarioOut | null>(null);
  const [dialogoClienteAbierto, setDialogoClienteAbierto] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<ClienteOut | null>(null);

  const tabParam = searchParams.get("tab");
  const pestanaActiva: PestanaAdmin = PESTANAS_VALIDAS.includes(tabParam as PestanaAdmin)
    ? (tabParam as PestanaAdmin)
    : "usuarios";

  function irAPestana(pestana: PestanaAdmin) {
    setSearchParams((prev) => {
      const siguiente = new URLSearchParams(prev);
      siguiente.set("tab", pestana);
      return siguiente;
    });
  }

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
          No tienes permiso para ver esta página. Solo un administrador puede gestionar usuarios,
          importadores, reglas de validación y cargos especiales del arancel.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-texto">Configuración</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Tabs value={pestanaActiva} onValueChange={(valor) => irAPestana(valor as PestanaAdmin)}>
          <TabsList>
            <TabsTrigger value="usuarios">Usuarios y roles</TabsTrigger>
            <TabsTrigger value="importadores">Importadores</TabsTrigger>
            <TabsTrigger value="reglas">Reglas de validación</TabsTrigger>
            <TabsTrigger value="datos-documentos">Datos de Documentos</TabsTrigger>
            <TabsTrigger value="cargos">Cargos especiales</TabsTrigger>
          </TabsList>

          <TabsContent value="usuarios">
            <EncabezadoSeccion
              descripcion="Altas, bajas y cambios de rol (Gestor / Liquidador / Administrador / Importador de portal). Crear pone la contraseña directamente; eliminar borra la cuenta por completo."
              accion="Nuevo usuario"
              onAccion={() => {
                setUsuarioEditando(null);
                setDialogoUsuarioAbierto(true);
              }}
            />
            {usuariosCargando ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <UsuariosTable
                usuarios={usuarios ?? []}
                onEditar={(usuario) => {
                  setUsuarioEditando(usuario);
                  setDialogoUsuarioAbierto(true);
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="importadores">
            <EncabezadoSeccion
              descripcion="Los dueños de los despachos. Registrar un importador permite vincularle despachos, elegirlo al crear uno nuevo, y darle acceso al portal (con una cuenta de rol Importador)."
              accion="Nuevo importador"
              onAccion={() => {
                setClienteEditando(null);
                setDialogoClienteAbierto(true);
              }}
            />
            {clientesCargando ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ClientesTable
                clientes={clientes ?? []}
                onEditar={(cliente) => {
                  setClienteEditando(cliente);
                  setDialogoClienteAbierto(true);
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="reglas">
            <EncabezadoSeccion
              descripcion="Comparaciones cruzadas entre documentos que corren al procesar un despacho. Desactivar una regla la excluye sin borrarla."
              accion="Nueva regla"
              onAccion={() => {
                setReglaEditando(null);
                setDialogoAbierto(true);
              }}
            />
            {reglasCargando ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ReglasValidacionTable
                reglas={reglas ?? []}
                onEditar={(regla) => {
                  setReglaEditando(regla);
                  setDialogoAbierto(true);
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="datos-documentos">
            <EncabezadoSeccion descripcion="Qué datos se extraen de cada tipo de documento. Es una referencia para armar reglas de validación; no se edita desde aquí." />
            <DatosDocumentosPanel />
          </TabsContent>

          <TabsContent value="cargos">
            <EncabezadoSeccion
              descripcion="Tasas de antidumping y derecho específico por subpartida (no hay fuente oficial CSV/API para esto -- son resoluciones puntuales de INDECOPI/MEF). Se usan como valor sugerido al calcular la pre-liquidación de un despacho."
              accion="Nuevo cargo"
              onAccion={() => {
                setCargoEditando(null);
                setDialogoCargoAbierto(true);
              }}
            />
            {cargosCargando ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <CargosEspecialesTable
                cargos={cargos ?? []}
                onEditar={(cargo) => {
                  setCargoEditando(cargo);
                  setDialogoCargoAbierto(true);
                }}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Los dialogos viven fuera de las pestañas: TabsContent desmonta la
          pestaña inactiva, y un dialogo abierto no deberia depender de eso. */}
      <UsuarioForm open={dialogoUsuarioAbierto} onOpenChange={setDialogoUsuarioAbierto} usuario={usuarioEditando} />
      <ClienteForm open={dialogoClienteAbierto} onOpenChange={setDialogoClienteAbierto} cliente={clienteEditando} />
      <ReglaValidacionForm open={dialogoAbierto} onOpenChange={setDialogoAbierto} regla={reglaEditando} />
      <CargoEspecialForm open={dialogoCargoAbierto} onOpenChange={setDialogoCargoAbierto} cargo={cargoEditando} />
    </div>
  );
}

/** Descripción de la sección a la izquierda y, si la pestaña permite
 * altas, el botón a la derecha. */
function EncabezadoSeccion({
  descripcion,
  accion,
  onAccion,
}: {
  descripcion: ReactNode;
  accion?: string;
  onAccion?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
      <p className="max-w-3xl text-sm text-texto-secundario">{descripcion}</p>
      {accion && onAccion && (
        <Button type="button" onClick={onAccion}>
          <Plus className="size-4" />
          {accion}
        </Button>
      )}
    </div>
  );
}
