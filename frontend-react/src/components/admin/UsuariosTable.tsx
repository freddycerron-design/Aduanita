import { Pencil, Trash2 } from "lucide-react";

import { useActualizarUsuario } from "@/hooks/useActualizarUsuario";
import { useEliminarUsuario } from "@/hooks/useEliminarUsuario";
import { ROL_INFO } from "@/lib/roles";
import type { UsuarioOut } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface UsuariosTableProps {
  usuarios: UsuarioOut[];
  onEditar: (usuario: UsuarioOut) => void;
}

const VARIANTE_ROL: Record<UsuarioOut["rol"], "coral" | "amber" | "verde"> = {
  ADMIN: "coral",
  LIQUIDADOR: "amber",
  GESTOR: "verde",
};

/** Tabla de usuarios -- mismo patrón que `ReglasValidacionTable`: el
 * toggle de `activo` reusa la mutación de editar (igual que
 * `alternarActivo` en reglas), eliminar es un borrado definitivo real de
 * la cuenta de Auth (confirmado con el usuario), no una desactivación. */
export function UsuariosTable({ usuarios, onEditar }: UsuariosTableProps) {
  const actualizar = useActualizarUsuario();
  const eliminar = useEliminarUsuario();

  function alternarActivo(usuario: UsuarioOut) {
    actualizar.mutate({
      id: usuario.id,
      datos: { nombre_completo: usuario.nombre_completo, rol: usuario.rol, activo: !usuario.activo },
    });
  }

  function confirmarEliminar(usuario: UsuarioOut) {
    if (
      window.confirm(
        `¿Eliminar la cuenta de "${usuario.nombre_completo}" (${usuario.email})? Esto borra su acceso por completo y no se puede deshacer.`,
      )
    ) {
      eliminar.mutate(usuario.id);
    }
  }

  if (usuarios.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
        No hay usuarios registrados todavía.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Usuario</TableHead>
          <TableHead>Rol</TableHead>
          <TableHead>Activo</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {usuarios.map((usuario) => (
          <TableRow key={usuario.id}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">{usuario.nombre_completo}</span>
                <span className="text-xs text-texto-secundario">{usuario.email}</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={VARIANTE_ROL[usuario.rol]}>{ROL_INFO[usuario.rol].label}</Badge>
            </TableCell>
            <TableCell>
              <button
                type="button"
                onClick={() => alternarActivo(usuario)}
                disabled={actualizar.isPending}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                aria-pressed={usuario.activo}
                aria-label={usuario.activo ? "Desactivar usuario" : "Activar usuario"}
              >
                <Badge variant={usuario.activo ? "verde" : "neutral"}>
                  {usuario.activo ? "Activo" : "Inactivo"}
                </Badge>
              </button>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onEditar(usuario)}
                  aria-label={`Editar ${usuario.nombre_completo}`}
                  title="Editar"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => confirmarEliminar(usuario)}
                  disabled={eliminar.isPending}
                  aria-label={`Eliminar ${usuario.nombre_completo}`}
                  title="Eliminar"
                  className="text-rojo hover:bg-rojo/10 hover:text-rojo"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
