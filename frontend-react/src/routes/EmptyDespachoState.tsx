import { FolderOpen } from "lucide-react";

/** Estado inicial cuando no hay ningun despacho seleccionado: invita a
 * crear uno nuevo o elegir uno del Explorer en la barra lateral. */
export function EmptyDespachoState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FolderOpen className="size-10 text-texto-secundario" strokeWidth={1.5} />
      <p className="text-sm text-texto-secundario">
        Crea un despacho nuevo o elige uno del panel de Archivos para empezar.
      </p>
    </div>
  );
}
