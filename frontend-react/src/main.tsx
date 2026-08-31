import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App";
import { supabaseConfigError } from "@/lib/supabase";
import "@/styles/globals.css";

const root = createRoot(document.getElementById("root")!);

if (supabaseConfigError) {
  // Pantalla de diagnostico en vez de una app rota a medias: sin
  // VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY nada de auth/datos puede
  // funcionar, asi que ni se intenta montar <App/>. En un Static Site de
  // Render estas variables son build-time (Vite las incrusta al compilar)
  // -- si faltan hace falta completarlas en el servicio y disparar un
  // deploy manual nuevo, no alcanza con solo guardarlas.
  root.render(
    <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: "#10141C", color: "#F4F5F7", fontFamily: "sans-serif", padding: "1.5rem", textAlign: "center" }}>
      <div style={{ maxWidth: "32rem" }}>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          Configuración incompleta
        </h1>
        <p style={{ fontSize: "0.9rem", color: "#93A0B4", lineHeight: 1.5 }}>{supabaseConfigError}</p>
        <p style={{ fontSize: "0.8rem", color: "#93A0B4", marginTop: "1rem", lineHeight: 1.5 }}>
          Completa las variables de entorno en el servicio de Render y vuelve a desplegar (en un Static
          Site son build-time: guardarlas no alcanza, hace falta un deploy nuevo).
        </p>
      </div>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
