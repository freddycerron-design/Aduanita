import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import logo from "@/assets/logo_aduafy.webp";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const loginSchema = z.object({
  email: z.string().min(1, "El correo es obligatorio.").email("Ingresa un correo válido."),
  password: z.string().min(1, "La contraseña es obligatoria."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/** Traduce los errores de Supabase Auth a un mensaje en español antes de
 * mostrarlos. Supabase devuelve `error.message` en inglés y con detalle
 * técnico; al usuario solo le sirve saber qué hacer. Se mira el `status`
 * HTTP (429) además del texto porque el mensaje de rate limit cambia entre
 * versiones de GoTrue. Cualquier caso no reconocido cae al genérico en vez
 * de filtrar el texto crudo en inglés. */
function traducirErrorLogin(error: { message: string; status?: number }): string {
  const mensaje = error.message.toLowerCase();
  if (mensaje.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (mensaje.includes("email not confirmed")) return "Tu correo todavía no está confirmado.";
  if (error.status === 429 || mensaje.includes("rate limit")) {
    return "Demasiados intentos. Espera un momento e intenta de nuevo.";
  }
  if (mensaje.includes("failed to fetch") || mensaje.includes("network") || mensaje.includes("load failed")) {
    return "No se pudo conectar. Revisa tu conexión e intenta de nuevo.";
  }
  return "No se pudo iniciar sesión. Intenta de nuevo.";
}

/** Ubicacion guardada por `RequireAuth` (ver state={{ from: location }})
 * antes de redirigir a /login, para volver ahi tras un login exitoso. */
interface LoginLocationState {
  from?: { pathname: string; search: string; hash: string };
}

/**
 * Pantalla de login: email/password contra Supabase Auth. Centrada en una
 * columna angosta (a diferencia del dashboard de Streamlit, donde el login
 * se estiraba a todo el ancho de la pantalla). `useSession`/
 * `onAuthStateChange` (montado en App.tsx) actualiza el store de auth
 * solo apenas `signInWithPassword` resuelve -- aca solo hace falta
 * navegar de vuelta a donde el usuario intentaba entrar.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [errorLogin, setErrorLogin] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(valores: LoginFormValues) {
    setErrorLogin(null);
    let error: { message: string; status?: number } | null;
    try {
      ({ error } = await supabase.auth.signInWithPassword(valores));
    } catch (excepcion) {
      // Un fallo de red puede llegar como excepción en vez de como `error`
      // devuelto -- se traduce igual en vez de dejar el submit colgado.
      error = { message: excepcion instanceof Error ? excepcion.message : String(excepcion) };
    }
    if (error) {
      const mensaje = traducirErrorLogin(error);
      setErrorLogin(mensaje);
      toast.error(mensaje);
      return;
    }

    const state = location.state as LoginLocationState | null;
    const destino = state?.from ? `${state.from.pathname}${state.from.search}${state.from.hash}` : "/";
    navigate(destino, { replace: true });
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
        <img src={logo} alt="Aduafy" className="w-48" />

        <Card className="w-full">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-base font-semibold text-texto">Iniciar sesión</h1>
              <p className="text-sm text-texto-secundario">
                Revisión documental y clasificación arancelaria de tus despachos.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nombre@empresa.com"
                  disabled={isSubmitting}
                  {...register("email")}
                />
                {errors.email && <p className="text-xs text-rojo">{errors.email.message}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  {...register("password")}
                />
                {errors.password && <p className="text-xs text-rojo">{errors.password.message}</p>}
              </div>

              {errorLogin && (
                <p className="rounded-lg border border-rojo/40 bg-rojo/10 px-3 py-2 text-sm text-rojo">
                  {errorLogin}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Ingresando..." : "Ingresar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
