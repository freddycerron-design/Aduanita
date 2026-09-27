import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { useCrearDespacho } from "@/hooks/useCrearDespacho";
import { useClientes } from "@/hooks/useClientes";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Centinela del select: "sin cliente registrado" (Radix Select no acepta
 * un value=""). Se traduce a null al enviar. */
const SIN_CLIENTE = "__sin_cliente__";

const nuevoDespachoSchema = z.object({
  numero_despacho: z.string().min(1, "El número de despacho es obligatorio."),
  cliente: z.string().min(1, "El cliente es obligatorio."),
  descripcion: z.string(),
  id_cliente: z.string(),
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
 *
 * Opcionalmente se puede vincular a un cliente REGISTRADO (tabla
 * clientes): eso es lo que hace que el despacho aparezca en el portal de
 * ese importador. Sin vincular, el despacho existe igual pero solo con el
 * nombre en texto libre.
 */
export function NuevoDespachoDialog({ open, onOpenChange }: NuevoDespachoDialogProps) {
  const navigate = useNavigate();
  const { mutate, isPending } = useCrearDespacho();
  const { data: clientes } = useClientes();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<NuevoDespachoFormValues>({
    resolver: zodResolver(nuevoDespachoSchema),
    defaultValues: { numero_despacho: "", cliente: "", descripcion: "", id_cliente: SIN_CLIENTE },
  });

  // Al cerrarse (cancelar, Escape, click afuera) se limpia el formulario
  // para que la proxima apertura no arrastre valores de un intento previo.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  /** Elegir un cliente registrado completa tambien el nombre en texto
   * libre, para no tener que escribirlo dos veces. */
  function elegirCliente(id: string) {
    setValue("id_cliente", id);
    const elegido = (clientes ?? []).find((c) => c.id === id);
    if (elegido) setValue("cliente", elegido.razon_social, { shouldValidate: true });
  }

  function onSubmit(valores: NuevoDespachoFormValues) {
    const payload = {
      numero_despacho: valores.numero_despacho,
      cliente: valores.cliente,
      descripcion: valores.descripcion.trim() || null,
      id_cliente: valores.id_cliente === SIN_CLIENTE ? null : valores.id_cliente,
    };
    mutate(payload, {
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
            <Label>Cliente registrado (opcional)</Label>
            <Select value={watch("id_cliente")} onValueChange={elegirCliente} disabled={isPending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CLIENTE}>Sin vincular</SelectItem>
                {(clientes ?? []).map((cliente) => (
                  <SelectItem key={cliente.id} value={cliente.id}>
                    {cliente.razon_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-texto-secundario">
              Vincularlo hace que el despacho aparezca en el portal de ese importador.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cliente">Nombre del cliente</Label>
            <Input id="cliente" disabled={isPending} {...register("cliente")} />
            {errors.cliente && <p className="text-xs text-rojo">{errors.cliente.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Textarea
              id="descripcion"
              rows={2}
              placeholder="Qué trae el despacho, para identificarlo en el Explorador"
              disabled={isPending}
              {...register("descripcion")}
            />
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
