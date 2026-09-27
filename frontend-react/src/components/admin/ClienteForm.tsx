import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { useGuardarCliente } from "@/hooks/useGuardarCliente";
import type { ClienteOut, ClienteUpsert } from "@/lib/types";
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

interface FormValues {
  razon_social: string;
  ruc: string;
  activo: boolean;
}

function valoresIniciales(cliente: ClienteOut | null): FormValues {
  return {
    razon_social: cliente?.razon_social ?? "",
    ruc: cliente?.ruc ?? "",
    activo: cliente?.activo ?? true,
  };
}

function aRequest(v: FormValues): ClienteUpsert {
  return {
    razon_social: v.razon_social.trim(),
    ruc: v.ruc.trim() || null,
    activo: v.activo,
  };
}

export interface ClienteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = crear un cliente nuevo; uno existente = editarlo. */
  cliente: ClienteOut | null;
}

/** Modal de crear/editar un importador -- mismo patrón de diálogo que el
 * resto de Administración. */
export function ClienteForm({ open, onOpenChange, cliente }: ClienteFormProps) {
  const guardar = useGuardarCliente();
  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: valoresIniciales(cliente),
  });

  useEffect(() => {
    reset(valoresIniciales(cliente));
  }, [cliente, reset]);

  function onSubmit(v: FormValues) {
    guardar.mutate({ id: cliente?.id, datos: aRequest(v) }, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cliente ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
          <DialogDescription>
            El importador dueño de los despachos. Registrarlo acá permite vincularle despachos y darle
            acceso al portal con una cuenta de rol Cliente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cliente-razon">Razón social</Label>
            <Input id="cliente-razon" required {...register("razon_social")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cliente-ruc">RUC (opcional)</Label>
            <Input id="cliente-ruc" className="font-mono" placeholder="20123456789" {...register("ruc")} />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="cliente-activo"
              type="checkbox"
              className="size-4 rounded border-border"
              {...register("activo")}
            />
            <Label htmlFor="cliente-activo" className="font-normal">
              Cliente activo
            </Label>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
