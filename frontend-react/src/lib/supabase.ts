import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Si faltan las variables de entorno, NO se lanza una excepcion aca -- un
 * throw a nivel de modulo pasa durante la evaluacion del grafo de imports,
 * antes de que main.tsx llegue a montar React, asi que la pantalla queda
 * en blanco sin ningun mensaje (asi se manifesto un despliegue real con
 * las VITE_* sin configurar: pantalla en blanco muda, nada que depurar).
 * En su lugar se expone este flag; `main.tsx` lo chequea antes de montar
 * <App/> y renderiza una pantalla de diagnostico si esta seteado.
 */
export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? "Faltan las variables de entorno VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en este despliegue."
    : null;

/** Bucket privado donde el backend guarda los documentos subidos --
 * PDF o imagen segun lo que suba el especialista
 * (`{id_despacho}/{tipo_documento}.{pdf|jpg|png|webp}`), ver
 * app/main.py::subir_documento. */
export const SUPABASE_STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "documentos-aduaneros";

/**
 * Cliente unico de Supabase para todo el frontend. `signInWithPassword`
 * actualiza el estado de auth de ESTA instancia y ese estado se propaga
 * automaticamente a los sub-clientes `.auth`/`.storage` (misma logica que
 * usaba el dashboard de Streamlit con supabase-py) -- por eso el resto del
 * codigo (p.ej. `getSignedPdfUrl`) no necesita pasar el token a mano.
 *
 * Si faltan las variables de entorno se crea igual con valores de relleno
 * (createClient exige strings no vacios) -- nunca deberia usarse de verdad
 * porque main.tsx corta antes por `supabaseConfigError`, pero evita que
 * este modulo explote al importarse.
 */
export const supabase = createClient(supabaseUrl || "https://config-incompleta.invalid", supabaseAnonKey || "config-incompleta", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "aduanita-auth",
  },
});

/** URL firmada temporal (5 min) para previsualizar un PDF de Storage sin
 * descargar los bytes al cliente y sin re-codificarlos en cada render
 * (a diferencia del dashboard de Streamlit, que traia el PDF completo como
 * bytes y lo embebia como data URI base64 en cada rerun). */
export async function getSignedPdfUrl(pathStorage: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(pathStorage, 300);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "No se pudo generar la URL firmada del PDF.");
  }
  return data.signedUrl;
}
