import type { Rol } from "@/lib/types";

/**
 * Espejo en el cliente de `_requiere_rol` (app/main.py): ADMIN siempre
 * puede, el resto solo si su rol esta en la lista permitida. Esto es solo
 * para habilitar/deshabilitar acciones en la UI -- el backend sigue
 * siendo la autoridad final (responde 403 si se intenta de todos modos).
 */
function tieneRol(rol: Rol | null | undefined, permitidos: Rol[]): boolean {
  if (!rol) return false;
  return rol === "ADMIN" || permitidos.includes(rol);
}

/** Puede subir/eliminar documentos, presionar "Procesar informacion" y
 * "Enviar a Clasificacion" (antes se llamaba ESPECIALISTA, renombrado a
 * GESTOR). */
export function puedeEnviarAClasificacion(rol: Rol | null | undefined): boolean {
  return tieneRol(rol, ["GESTOR"]);
}

/** Puede aceptar/observar la propuesta de clasificacion
 * (POST /despachos/{id}/decision). */
export function puedeDecidirClasificacion(rol: Rol | null | undefined): boolean {
  return tieneRol(rol, ["LIQUIDADOR"]);
}

/** Puede calcular/recalcular la pre-liquidacion de tributos
 * (POST /despachos/{id}/preliquidacion/calcular) -- gestor o liquidador,
 * no es una accion exclusiva de un solo rol como las de arriba. */
export function puedeCalcularPreliquidacion(rol: Rol | null | undefined): boolean {
  return tieneRol(rol, ["GESTOR", "LIQUIDADOR"]);
}

/** Acceso a los CRUD de administracion (reglas de validacion, cargos
 * especiales del arancel, usuarios). A diferencia de `tieneRol` (disenada
 * para "rol de negocio O ADMIN"), esto es "solo ADMIN" -- espejo exacto
 * de `_requiere_rol(usuario, set())` en app/main.py (un set vacio de
 * roles permitidos: nada de negocio pasa, solo el bypass de ADMIN). No
 * reusar `tieneRol` aca. */
export function esAdmin(rol: Rol | null | undefined): boolean {
  return rol === "ADMIN";
}

/** Etiqueta en español + para mostrar el rol en la UI -- nunca el valor
 * crudo en mayúsculas (ver AccountPanel, UsuariosTable). */
export const ROL_INFO: Record<Rol, { label: string }> = {
  ADMIN: { label: "Administrador" },
  GESTOR: { label: "Gestor" },
  LIQUIDADOR: { label: "Liquidador" },
};
