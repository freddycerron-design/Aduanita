/** Parametros de `useDespachosPaginados` -- forman parte de la queryKey
 * para que cada pagina/busqueda tenga su propia entrada en cache. */
export interface ParametrosListaDespachos {
  pagina: number;
  limite: number;
  busqueda: string;
}

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
     * Con `params`, identifica la pagina/busqueda puntual que pidio la
     * pestaña Explorador. */
    list: (params?: ParametrosListaDespachos) =>
      params ? (["despachos", "list", params] as const) : (["despachos"] as const),
    detail: (id: string) => ["despachos", id] as const,
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
