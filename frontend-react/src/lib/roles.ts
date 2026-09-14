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

/** Puede subir/eliminar documentos y presionar "Procesar informacion"
 * (POST /despachos/{id}/enviar-a-clasificacion). */
export function puedeEnviarAClasificacion(rol: Rol | null | undefined): boolean {
  return tieneRol(rol, ["ESPECIALISTA"]);
}

/** Puede aceptar/observar la propuesta de clasificacion
 * (POST /despachos/{id}/decision). */
export function puedeDecidirClasificacion(rol: Rol | null | undefined): boolean {
  return tieneRol(rol, ["LIQUIDADOR"]);
}

/** Puede calcular/recalcular la pre-liquidacion de tributos
 * (POST /despachos/{id}/preliquidacion/calcular) -- especialista o
 * liquidador, no es una accion exclusiva de un solo rol como las de
 * arriba. */
export function puedeCalcularPreliquidacion(rol: Rol | null | undefined): boolean {
  return tieneRol(rol, ["ESPECIALISTA", "LIQUIDADOR"]);
}

/** Acceso al CRUD de reglas de validacion (/admin/reglas-validacion).
 * A diferencia de `tieneRol` (disenada para "rol de negocio O ADMIN"),
 * esto es "solo ADMIN" -- espejo exacto de `_requiere_rol(usuario, set())`
 * en app/main.py (un set vacio de roles permitidos: nada de negocio pasa,
 * solo el bypass de ADMIN). No reusar `tieneRol` aca. */
export function esAdmin(rol: Rol | null | undefined): boolean {
  return rol === "ADMIN";
}
