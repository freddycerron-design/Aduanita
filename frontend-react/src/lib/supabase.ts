import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y completa los valores.",
  );
}

/** Bucket privado donde el backend guarda los PDFs subidos
 * (`{id_despacho}/{tipo_documento}.pdf`), ver app/main.py::subir_documento. */
export const SUPABASE_STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "documentos-aduaneros";

/**
 * Cliente unico de Supabase para todo el frontend. `signInWithPassword`
 * actualiza el estado de auth de ESTA instancia y ese estado se propaga
 * automaticamente a los sub-clientes `.auth`/`.storage` (misma logica que
 * usaba el dashboard de Streamlit con supabase-py) -- por eso el resto del
 * codigo (p.ej. `getSignedPdfUrl`) no necesita pasar el token a mano.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
