import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import logo from "@/assets/logo_aduanita.png";
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
    const { error } = await supabase.auth.signInWithPassword(valores);
    if (error) {
      setErrorLogin(error.message);
      toast.error(error.message);
      return;
    }

    const state = location.state as LoginLocationState | null;
    const destino = state?.from ? `${state.from.pathname}${state.from.search}${state.from.hash}` : "/";
    navigate(destino, { replace: true });
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
        <img src={logo} alt="AduANITA" className="w-72" />

        <Card className="w-full">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-base font-semibold text-texto">Iniciar sesión</h1>
              <p className="text-sm text-texto-secundario">
                Automatización de revisión documental aduanera y clasificación arancelaria asistida.
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
