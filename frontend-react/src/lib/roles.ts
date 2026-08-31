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
