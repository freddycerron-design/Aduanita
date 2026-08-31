/** Factory centralizada de query keys de TanStack Query -- evita que cada
 * hook invente su propia forma de key y rompa la invalidacion cruzada. */
export const queryKeys = {
  despachos: {
    list: () => ["despachos"] as const,
    detail: (id: string) => ["despachos", id] as const,
  },
  perfil: (userId: string) => ["perfil", userId] as const,
  pdfSignedUrl: (pathStorage: string) => ["pdf-signed-url", pathStorage] as const,
};
