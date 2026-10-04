import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { useCrearUsuario } from "@/hooks/useCrearUsuario";
import { useActualizarUsuario } from "@/hooks/useActualizarUsuario";
import { useClientes } from "@/hooks/useClientes";
import { ROL_INFO } from "@/lib/roles";
import type { Rol, UsuarioOut } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLES: Rol[] = ["GESTOR", "LIQUIDADOR", "ADMIN", "CLIENTE"];

/** Valor centinela del select: "sin cliente vinculado". Radix Select no
 * acepta un <SelectItem value=""> (string vacio), asi que hace falta un
 * valor concreto que se traduce a null al enviar. */
const SIN_CLIENTE = "__sin_cliente__";

interface FormValues {
  email: string;
  password: string;
  nombre_completo: string;
  rol: Rol;
  activo: boolean;
  id_cliente: string;
}

function valoresIniciales(usuario: UsuarioOut | null): FormValues {
  return {
    email: usuario?.email ?? "",
    password: "",
    nombre_completo: usuario?.nombre_completo ?? "",
    rol: usuario?.rol ?? "GESTOR",
    activo: usuario?.activo ?? true,
    id_cliente: usuario?.id_cliente ?? SIN_CLIENTE,
  };
}

export interface UsuarioFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = crear un usuario nuevo; uno existente = editarlo. */
  usuario: UsuarioOut | null;
}

/**
 * Modal de crear/editar un usuario -- mismo patrón de diálogo que
 * `ReglaValidacionForm`/`CargoEspecialForm`, pero crear y editar usan
 * hooks distintos (payloads distintos: alta pide email+password, edición
 * pide nombre/rol/activo + una contraseña opcional para resetear). El
 * email nunca se puede cambiar desde acá -- cambiar el email de una
 * cuenta de Auth ya existente queda fuera de alcance.
 */
export function UsuarioForm({ open, onOpenChange, usuario }: UsuarioFormProps) {
  const crear = useCrearUsuario();
  const actualizar = useActualizarUsuario();
  const { data: clientes } = useClientes();
  const guardando = crear.isPending || actualizar.isPending;

  const { register, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: valoresIniciales(usuario),
  });

  useEffect(() => {
    reset(valoresIniciales(usuario));
  }, [usuario, reset]);

  function onSubmit(v: FormValues) {
    // El backend ignora id_cliente para roles internos, pero se manda
    // limpio igual para que el request diga lo que de verdad significa.
    const idCliente = v.rol === "CLIENTE" && v.id_cliente !== SIN_CLIENTE ? v.id_cliente : null;

    if (usuario) {
      actualizar.mutate(
        {
          id: usuario.id,
          datos: {
            nombre_completo: v.nombre_completo,
            rol: v.rol,
            activo: v.activo,
            password: v.password.trim() || undefined,
            id_cliente: idCliente,
          },
        },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      crear.mutate(
        {
          email: v.email.trim(),
          password: v.password,
          nombre_completo: v.nombre_completo,
          rol: v.rol,
          id_cliente: idCliente,
        },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{usuario ? "Editar usuario" : "Nuevo usuario"}</DialogTitle>
          <DialogDescription>
            {usuario
              ? "El correo no se puede cambiar acá. Dejar la contraseña en blanco para no modificarla."
              : "Se crea la cuenta con la contraseña que escribas -- la persona ya puede entrar con ella."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {!usuario && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="usuario-email">Correo</Label>
              <Input id="usuario-email" type="email" required {...register("email")} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="usuario-nombre">Nombre completo</Label>
            <Input id="usuario-nombre" required {...register("nombre_completo")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="usuario-password">{usuario ? "Nueva contraseña (opcional)" : "Contraseña"}</Label>
            <Input
              id="usuario-password"
              type="password"
              autoComplete="new-password"
              required={!usuario}
              minLength={6}
              placeholder={usuario ? "Dejar vacío para no cambiar" : undefined}
              {...register("password")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Rol</Label>
            <Select value={watch("rol")} onValueChange={(v) => setValue("rol", v as Rol)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((rol) => (
                  <SelectItem key={rol} value={rol}>
                    {ROL_INFO[rol].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {watch("rol") === "CLIENTE" && (
            <div className="flex flex-col gap-2">
              <Label>Importador vinculado</Label>
              <Select
                value={watch("id_cliente")}
                onValueChange={(v) => setValue("id_cliente", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_CLIENTE}>Sin vincular</SelectItem>
                  {(clientes ?? []).map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.razon_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[13px] text-texto-secundario">
                Una cuenta de portal sin importador vinculado no puede ver ningún despacho.
              </p>
            </div>
          )}

          {usuario && (
            <div className="flex items-center gap-2">
              <input
                id="usuario-activo"
                type="checkbox"
                className="size-4 rounded border-border"
                {...register("activo")}
              />
              <Label htmlFor="usuario-activo" className="font-normal">
                Cuenta activa
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
