import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { crearUsuario } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { UsuarioCreate } from "@/lib/types";

/** Crea una cuenta de Auth nueva (con la contraseña que puso el admin) +
 * su perfil de negocio. Payload distinto al de editar (trae email +
 * password), por eso es un hook separado de `useActualizarUsuario` en
 * vez de un solo "guardar" combinado como en reglas de validación. */
export function useCrearUsuario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (datos: UsuarioCreate) => crearUsuario(datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.usuarios.list() });
      toast.success("Usuario creado.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el usuario.");
    },
  });
}
