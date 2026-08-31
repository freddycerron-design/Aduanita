import { useQuery } from "@tanstack/react-query";

import { getSignedPdfUrl } from "@/lib/supabase";
import { queryKeys } from "@/lib/queryKeys";

/**
 * URL firmada (5 min) de un PDF en Storage. Se pide de forma perezosa --
 * solo cuando `habilitado` es true -- para no gastar llamadas a Storage
 * mientras el usuario esta mirando el visor en modo JSON. `staleTime` se
 * mantiene por debajo de la vida de la URL firmada, no tiene sentido
 * cachear mas alla de eso.
 */
export function useSignedPdfUrl(pathStorage: string, habilitado: boolean) {
  return useQuery({
    queryKey: queryKeys.pdfSignedUrl(pathStorage),
    queryFn: () => getSignedPdfUrl(pathStorage),
    enabled: habilitado && !!pathStorage,
    staleTime: 4 * 60 * 1000,
  });
}
