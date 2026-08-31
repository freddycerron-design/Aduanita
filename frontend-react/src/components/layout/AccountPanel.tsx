import { CircleUser } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useProfile } from "@/hooks/useProfile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Panel "Cuenta": correo del usuario autenticado + rol (leido de
 * `perfiles_especialista` via `useProfile`) + cerrar sesion. El store de
 * auth se actualiza solo via `onAuthStateChange` y `RequireAuth` redirige
 * solo a /login apenas la sesion desaparezca -- aqui no hay que hacer nada
 * mas que llamar a `signOut`.
 */
export function AccountPanel() {
  const email = useAuthStore((state) => state.session?.user.email);
  const { data: perfil, isLoading } = useProfile();

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-texto-secundario">Cuenta</h2>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
        <CircleUser className="size-8 shrink-0 text-texto-secundario" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="truncate text-sm text-texto">{email ?? "..."}</span>
          {isLoading ? <Skeleton className="h-5 w-24" /> : <Badge variant="coral">{perfil?.rol ?? "..."}</Badge>}
        </div>
      </div>

      <p className="text-xs text-texto-secundario">
        El rol define que acciones puedes tomar: el especialista sube documentos y envia a
        clasificacion; el liquidador acepta u observa la propuesta de subpartida.
      </p>

      <Separator />

      <Button variant="outline" className="w-full" onClick={() => void supabase.auth.signOut()}>
        Cerrar sesión
      </Button>
    </div>
  );
}
