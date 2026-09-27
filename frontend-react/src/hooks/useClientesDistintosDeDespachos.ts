import { useQuery } from "@tanstack/react-query";

import { listarClientesDistintosDeDespachos } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthStore } from "@/hooks/useAuthStore";

/** Valores únicos que hoy existen en `despacho.cliente`, para poblar el
 * filtro "estilo Excel" de esa columna en `ExploradorTab`. Cambia poco
 * (solo al crear un despacho con un cliente nuevo), así que no necesita
 * invalidación activa desde `useCrearDespacho` -- basta con que quede
 * fresco la próxima vez que se abra el filtro. */
export function useClientesDistintosDeDespachos() {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: queryKeys.despachos.clientesDistintos(),
    queryFn: listarClientesDistintosDeDespachos,
    enabled: status === "authenticated",
  });
}
