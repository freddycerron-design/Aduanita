import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Notificaciones tipo toast (reemplazan los st.success/st.error/st.warning
 * de Streamlit). Estilizado a mano con las variables CSS de nuestra
 * paleta -- sonner no trae un theme "EstimaDORA" propio. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast !bg-surface !text-texto !border !border-surface-border !rounded-xl !shadow-xl",
          description: "!text-texto-secundario",
          actionButton: "!bg-coral !text-white",
          cancelButton: "!bg-surface-border !text-texto",
          error: "!border-rojo/50",
          success: "!border-verde/50",
        },
      }}
      {...props}
    />
  );
}
