import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { useCrearDespacho } from "@/hooks/useCrearDespacho";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const nuevoDespachoSchema = z.object({
  numero_despacho: z.string().min(1, "El número de despacho es obligatorio."),
  cliente: z.string().min(1, "El cliente es obligatorio."),
});

type NuevoDespachoFormValues = z.infer<typeof nuevoDespachoSchema>;

interface NuevoDespachoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal para crear un despacho nuevo (numero + cliente, ambos
 * obligatorios). El despacho arranca siempre en REVISION_DOC del lado del
 * backend, asi que tras crearlo navegamos directo a su pagina de detalle.
 */
export function NuevoDespachoDialog({ open, onOpenChange }: NuevoDespachoDialogProps) {
  const navigate = useNavigate();
  const { mutate, isPending } = useCrearDespacho();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NuevoDespachoFormValues>({
    resolver: zodResolver(nuevoDespachoSchema),
    defaultValues: { numero_despacho: "", cliente: "" },
  });

  // Al cerrarse (cancelar, Escape, click afuera) se limpia el formulario
  // para que la proxima apertura no arrastre valores de un intento previo.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  function onSubmit(valores: NuevoDespachoFormValues) {
    mutate(valores, {
      onSuccess: (despacho) => {
        onOpenChange(false);
        reset();
        navigate(`/despachos/${despacho.id}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo despacho</DialogTitle>
          <DialogDescription>Crea un despacho para empezar a subir sus documentos.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="numero_despacho">Número de despacho</Label>
            <Input id="numero_despacho" disabled={isPending} {...register("numero_despacho")} />
            {errors.numero_despacho && (
              <p className="text-xs text-rojo">{errors.numero_despacho.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cliente">Cliente</Label>
            <Input id="cliente" disabled={isPending} {...register("cliente")} />
            {errors.cliente && <p className="text-xs text-rojo">{errors.cliente.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando..." : "Crear despacho"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
