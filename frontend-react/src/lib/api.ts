import { supabase } from "@/lib/supabase";
import type {
  ActualizarBorradorRequest,
  BorradorCorreoOut,
  CalcularPreliquidacionRequest,
  CargoEspecialArancelOut,
  CargoEspecialArancelUpsert,
  DecisionRequest,
  DespachoCreate,
  DespachoDetalleOut,
  DespachoOut,
  DocumentoExtraidoOut,
  EstadoDespacho,
  HistorialClasificacionOut,
  PipelineResultOut,
  PreliquidacionDetalleOut,
  PreliquidacionOut,
  ReglaValidacionOut,
  ReglaValidacionUpsert,
  TipoDocumento,
  UsuarioCreate,
  UsuarioOut,
  UsuarioUpdate,
} from "@/lib/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Extrae un mensaje legible de una respuesta de error de FastAPI, que
 * normalmente trae `{"detail": "..."}` (HTTPException) pero a veces trae
 * `{"detail": [{"msg": "..."}, ...]}` (422 de validacion de Pydantic). */
async function mensajeDeError(respuesta: Response): Promise<string> {
  try {
    const cuerpo = await respuesta.json();
    const detail = cuerpo?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => item?.msg ?? JSON.stringify(item)).join("; ");
    }
    return respuesta.statusText || `Error ${respuesta.status}`;
  } catch {
    return respuesta.statusText || `Error ${respuesta.status}`;
  }
}

interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  json?: unknown;
  formData?: FormData;
  query?: Record<string, string | undefined>;
}

/**
 * Cliente HTTP centralizado hacia el backend FastAPI. El token se lee
 * fresco de la sesion de Supabase en cada llamada (nunca se cachea aparte)
 * para aprovechar el auto-refresh del cliente. Un 401 fuerza cierre de
 * sesion y vuelta al login -- mismo comportamiento de ultimo recurso que
 * tenia el dashboard de Streamlit.
 */
async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const url = new URL(path, API_BASE_URL);
  if (options.query) {
    for (const [clave, valor] of Object.entries(options.query)) {
      if (valor !== undefined) url.searchParams.set(clave, valor);
    }
  }

  const headers: HeadersInit = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData; // el navegador setea el Content-Type multipart con boundary
  } else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  const respuesta = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers,
    body,
  });

  if (respuesta.status === 401) {
    await supabase.auth.signOut();
    window.location.href = "/login";
    throw new ApiError(401, "Sesion expirada. Vuelve a iniciar sesion.");
  }

  if (!respuesta.ok) {
    throw new ApiError(respuesta.status, await mensajeDeError(respuesta));
  }

  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

/**
 * Variante de `apiFetch` para respuestas binarias (archivos para
 * descargar) -- mismo manejo de token/401 que `apiFetch`, pero devuelve
 * un `Blob` en vez de parsear JSON.
 */
async function apiFetchBlob(path: string): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: HeadersInit = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const respuesta = await fetch(new URL(path, API_BASE_URL).toString(), { headers });

  if (respuesta.status === 401) {
    await supabase.auth.signOut();
    window.location.href = "/login";
    throw new ApiError(401, "Sesion expirada. Vuelve a iniciar sesion.");
  }
  if (!respuesta.ok) {
    throw new ApiError(respuesta.status, await mensajeDeError(respuesta));
  }
  return respuesta.blob();
}

// --- despachos --------------------------------------------------------

export function listarDespachos(estado?: EstadoDespacho): Promise<DespachoOut[]> {
  return apiFetch<DespachoOut[]>("/despachos", { query: { estado } });
}

export function obtenerDespacho(idDespacho: string): Promise<DespachoDetalleOut> {
  return apiFetch<DespachoDetalleOut>(`/despachos/${idDespacho}`);
}

export function crearDespacho(datos: DespachoCreate): Promise<DespachoOut> {
  return apiFetch<DespachoOut>("/despachos", { method: "POST", json: datos });
}

// --- documentos ---------------------------------------------------------

export function subirDocumento(
  idDespacho: string,
  tipoDocumento: TipoDocumento,
  archivo: File,
): Promise<DocumentoExtraidoOut> {
  const formData = new FormData();
  formData.append("tipo_documento", tipoDocumento);
  formData.append("archivo", archivo);
  return apiFetch<DocumentoExtraidoOut>(`/despachos/${idDespacho}/documentos`, {
    method: "POST",
    formData,
  });
}

export function eliminarDocumento(
  idDespacho: string,
  tipoDocumento: TipoDocumento,
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/despachos/${idDespacho}/documentos/${tipoDocumento}`, {
    method: "DELETE",
  });
}

// --- pipeline (extraccion + validacion + clasificacion + borrador) --------

/** "Procesar información": extrae + valida + clasifica + genera borrador.
 * NO cambia el estado del despacho (ver `enviarAClasificacion` para eso). */
export function procesarInformacion(idDespacho: string): Promise<PipelineResultOut> {
  return apiFetch<PipelineResultOut>(`/despachos/${idDespacho}/procesar-informacion`, {
    method: "POST",
  });
}

/** Botón propio "Enviar a Clasificación": la única transición
 * REVISION_DOC -> CLASIFICACION. Exige que ya se haya presionado
 * "Procesar información" (FACTURA+BL procesados). */
export function enviarAClasificacion(idDespacho: string): Promise<DespachoOut> {
  return apiFetch<DespachoOut>(`/despachos/${idDespacho}/enviar-a-clasificacion`, {
    method: "POST",
  });
}

// --- borrador de correo ---------------------------------------------------------

export function editarBorrador(
  idBorrador: string,
  datos: ActualizarBorradorRequest,
): Promise<BorradorCorreoOut> {
  return apiFetch<BorradorCorreoOut>(`/borradores/${idBorrador}`, { method: "PATCH", json: datos });
}

// --- decision del liquidador ---------------------------------------------------------

export function registrarDecision(
  idDespacho: string,
  datos: DecisionRequest,
): Promise<HistorialClasificacionOut> {
  return apiFetch<HistorialClasificacionOut>(`/despachos/${idDespacho}/decision`, {
    method: "POST",
    json: datos,
  });
}

// --- reglas de validacion (admin) ---------------------------------------

export function listarReglasValidacion(): Promise<ReglaValidacionOut[]> {
  return apiFetch<ReglaValidacionOut[]>("/admin/reglas-validacion");
}

export function crearReglaValidacion(datos: ReglaValidacionUpsert): Promise<ReglaValidacionOut> {
  return apiFetch<ReglaValidacionOut>("/admin/reglas-validacion", { method: "POST", json: datos });
}

export function actualizarReglaValidacion(
  idRegla: string,
  datos: ReglaValidacionUpsert,
): Promise<ReglaValidacionOut> {
  return apiFetch<ReglaValidacionOut>(`/admin/reglas-validacion/${idRegla}`, {
    method: "PUT",
    json: datos,
  });
}

export function eliminarReglaValidacion(idRegla: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/admin/reglas-validacion/${idRegla}`, { method: "DELETE" });
}

// --- pre-liquidacion de tributos ---------------------------------------------------------

export function obtenerPreliquidacion(idDespacho: string): Promise<PreliquidacionDetalleOut> {
  return apiFetch<PreliquidacionDetalleOut>(`/despachos/${idDespacho}/preliquidacion`);
}

export function calcularPreliquidacion(
  idDespacho: string,
  datos: CalcularPreliquidacionRequest,
): Promise<PreliquidacionOut> {
  return apiFetch<PreliquidacionOut>(`/despachos/${idDespacho}/preliquidacion/calcular`, {
    method: "POST",
    json: datos,
  });
}

// --- cargos especiales del arancel (admin: antidumping / derecho especifico) --------

export function listarCargosEspeciales(): Promise<CargoEspecialArancelOut[]> {
  return apiFetch<CargoEspecialArancelOut[]>("/admin/cargos-especiales-arancel");
}

export function crearCargoEspecial(datos: CargoEspecialArancelUpsert): Promise<CargoEspecialArancelOut> {
  return apiFetch<CargoEspecialArancelOut>("/admin/cargos-especiales-arancel", {
    method: "POST",
    json: datos,
  });
}

export function actualizarCargoEspecial(
  idCargo: string,
  datos: CargoEspecialArancelUpsert,
): Promise<CargoEspecialArancelOut> {
  return apiFetch<CargoEspecialArancelOut>(`/admin/cargos-especiales-arancel/${idCargo}`, {
    method: "PUT",
    json: datos,
  });
}

export function eliminarCargoEspecial(idCargo: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/admin/cargos-especiales-arancel/${idCargo}`, { method: "DELETE" });
}

// --- usuarios y roles (admin) ---------------------------------------------------------

export function listarUsuarios(): Promise<UsuarioOut[]> {
  return apiFetch<UsuarioOut[]>("/admin/usuarios");
}

export function crearUsuario(datos: UsuarioCreate): Promise<UsuarioOut> {
  return apiFetch<UsuarioOut>("/admin/usuarios", { method: "POST", json: datos });
}

export function actualizarUsuario(idUsuario: string, datos: UsuarioUpdate): Promise<UsuarioOut> {
  return apiFetch<UsuarioOut>(`/admin/usuarios/${idUsuario}`, { method: "PUT", json: datos });
}

export function eliminarUsuario(idUsuario: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/admin/usuarios/${idUsuario}`, { method: "DELETE" });
}

// --- exportar despacho ---------------------------------------------------------

/** El export a JSON no pega al backend -- se arma client-side a partir
 * del `DespachoDetalleOut` ya cargado (ver hooks/useExportarDespacho.ts).
 * Esto es el unico que necesita ida y vuelta al servidor (generar un
 * .xlsx real requiere una libreria server-side). */
export function descargarExcelDespacho(idDespacho: string): Promise<Blob> {
  return apiFetchBlob(`/despachos/${idDespacho}/exportar-excel`);
}
