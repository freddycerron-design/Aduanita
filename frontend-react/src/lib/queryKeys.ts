import type { ListarDespachosParams } from "@/lib/api";

/** Factory centralizada de query keys de TanStack Query -- evita que cada
 * hook invente su propia forma de key y rompa la invalidacion cruzada. */
export const queryKeys = {
  despachos: {
    /** Sin argumentos devuelve el prefijo `["despachos"]` a proposito: por
     * el matching por prefijo por defecto de TanStack Query (`exact:
     * false`), invalidar con esta forma corta tambien invalida cualquier
     * `list(params)` en cache Y cualquier `detail(id)` activo -- varios
     * hooks (`useEditarBorrador`, `useEnviarAClasificacion`, etc.) dependen
     * de eso para refrescar el despacho abierto sin tener a mano su id.
     * Con `params`, identifica la pagina/busqueda/filtros/orden puntual
     * que pidio la pestaña Explorador (mismo shape que `listarDespachos`,
     * asi que no hay dos formas distintas de describir la misma consulta). */
    list: (params?: ListarDespachosParams) =>
      params ? (["despachos", "list", params] as const) : (["despachos"] as const),
    detail: (id: string) => ["despachos", id] as const,
    /** Valores distintos de `despacho.cliente`, para el filtro "estilo
     * Excel" de esa columna -- namespace propio, distinto de
     * `queryKeys.clientes.list()` (esa es la tabla de importadores
     * REGISTRADOS, un concepto separado). */
    clientesDistintos: () => ["despachos", "clientes-distintos"] as const,
    /** Gestores (perfiles_especialista) que crearon al menos un despacho,
     * para el filtro "estilo Excel" de esa columna. */
    gestoresDistintos: () => ["despachos", "gestores-distintos"] as const,
    /** GESTOR/ADMIN activos, para el Select de "gestor asignado" al
     * crear un despacho -- incluye a quien todavía no tiene ninguno. */
    gestoresAsignables: () => ["despachos", "gestores-asignables"] as const,
  },
  perfil: (userId: string) => ["perfil", userId] as const,
  pdfSignedUrl: (pathStorage: string) => ["pdf-signed-url", pathStorage] as const,
  reglasValidacion: {
    list: () => ["reglas-validacion"] as const,
  },
  preliquidacion: {
    detail: (idDespacho: string) => ["preliquidacion", idDespacho] as const,
  },
  cargosEspeciales: {
    list: () => ["cargos-especiales-arancel"] as const,
  },
  usuarios: {
    list: () => ["usuarios"] as const,
  },
  metricas: () => ["metricas"] as const,
  clientes: {
    list: () => ["clientes"] as const,
  },
  portal: {
    despachos: () => ["portal", "despachos"] as const,
  },
  arancel: {
    busqueda: (q: string) => ["arancel", q] as const,
  },
};
