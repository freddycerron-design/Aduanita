import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { useSession } from "@/hooks/useSession";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Toaster } from "@/components/ui/sonner";
import { LoginPage } from "@/routes/LoginPage";
import { DashboardLayout } from "@/routes/DashboardLayout";
import { DespachoPage } from "@/routes/DespachoPage";
import { EmptyDespachoState } from "@/routes/EmptyDespachoState";

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
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route index element={<EmptyDespachoState />} />
        <Route path="despachos/:id" element={<DespachoPage />} />
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
