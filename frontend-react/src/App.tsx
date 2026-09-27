import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { useSession } from "@/hooks/useSession";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireSurface } from "@/components/auth/RequireSurface";
import { PortalPage } from "@/routes/PortalPage";
import { Toaster } from "@/components/ui/sonner";
import { LoginPage } from "@/routes/LoginPage";
import { DashboardLayout } from "@/routes/DashboardLayout";
import { DespachoPage } from "@/routes/DespachoPage";
import { HomePage } from "@/routes/HomePage";
import { ArancelPage } from "@/routes/ArancelPage";
import { AdminPage } from "@/routes/AdminPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  // Se monta una sola vez en la raiz: inicializa la sesion de Supabase y
  // la mantiene sincronizada (login, logout, refresh de token).
  useSession();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Portal del importador: superficie separada, sin la barra lateral
          interna. Una cuenta del equipo que caiga acá se redirige a "/" y
          viceversa (ver RequireSurface). */}
      <Route
        path="/portal"
        element={
          <RequireAuth>
            <RequireSurface superficie="portal">
              <PortalPage />
            </RequireSurface>
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RequireSurface superficie="interna">
              <DashboardLayout />
            </RequireSurface>
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        {/* Sin id (lista/Explorador) y con id (detalle) renderizan el mismo
            shell -- ver DespachoPage, donde el Explorador es la primera
            pestaña de la misma tira que Revisión/Clasificación/etc. */}
        <Route path="despachos" element={<DespachoPage />} />
        <Route path="despachos/:id" element={<DespachoPage />} />
        <Route path="aranceles" element={<ArancelPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
