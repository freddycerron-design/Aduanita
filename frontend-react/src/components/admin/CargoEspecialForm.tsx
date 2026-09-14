import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { useGuardarCargoEspecial } from "@/hooks/useGuardarCargoEspecial";
import type { CargoEspecialArancelOut, CargoEspecialArancelUpsert } from "@/lib/types";
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
import { Textarea } from "@/components/ui/textarea";

interface FormValues {
  subpartida: string;
  antidumping_monto: string;
  derecho_especifico_monto: string;
  moneda: string;
  nota: string;
}

function valoresIniciales(cargo: CargoEspecialArancelOut | null): FormValues {
  return {
    subpartida: cargo?.subpartida ?? "",
    antidumping_monto: cargo ? String(cargo.antidumping_monto) : "0",
    derecho_especifico_monto: cargo ? String(cargo.derecho_especifico_monto) : "0",
    moneda: cargo?.moneda ?? "USD",
    nota: cargo?.nota ?? "",
  };
}

function aRequest(v: FormValues): CargoEspecialArancelUpsert {
  return {
    subpartida: v.subpartida.trim(),
    antidumping_monto: Number(v.antidumping_monto),
    derecho_especifico_monto: Number(v.derecho_especifico_monto),
    moneda: v.moneda.trim() || "USD",
    nota: v.nota.trim() || null,
  };
}

export interface CargoEspecialFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = crear un cargo nuevo; uno existente = editarlo. */
  cargo: CargoEspecialArancelOut | null;
}

/**
 * Modal de crear/editar un cargo especial (antidumping / derecho
 * específico) para una subpartida -- mismo patrón que
 * `ReglaValidacionForm`, mucho más chico porque no hay variantes de
 * shape. El backend valida que la subpartida exista en
 * partidas_arancelarias (400 si no) y que no se duplique (400 si ya
 * existe un cargo para esa subpartida).
 */
export function CargoEspecialForm({ open, onOpenChange, cargo }: CargoEspecialFormProps) {
  const guardar = useGuardarCargoEspecial();

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: valoresIniciales(cargo),
  });

  useEffect(() => {
    reset(valoresIniciales(cargo));
  }, [cargo, reset]);

  function onSubmit(v: FormValues) {
    guardar.mutate({ id: cargo?.id, datos: aRequest(v) }, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cargo ? "Editar cargo especial" : "Nuevo cargo especial"}</DialogTitle>
          <DialogDescription>
            Tasa de antidumping y/o derecho específico para una subpartida (resolución puntual de
            INDECOPI/MEF). Sirve como valor sugerido al calcular la pre-liquidación de un despacho; se
            puede sobreescribir por despacho igual.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cargo-subpartida">Subpartida (10 dígitos)</Label>
            <Input
              id="cargo-subpartida"
              className="font-mono"
              placeholder="9011.10.00.00"
              {...register("subpartida", { required: true })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cargo-antidumping">Antidumping</Label>
              <Input id="cargo-antidumping" type="number" step="0.01" {...register("antidumping_monto")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cargo-derecho">Derecho específico</Label>
              <Input id="cargo-derecho" type="number" step="0.01" {...register("derecho_especifico_monto")} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cargo-moneda">Moneda</Label>
            <Input id="cargo-moneda" className="w-24" {...register("moneda")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cargo-nota">Nota (fuente/resolución)</Label>
            <Textarea id="cargo-nota" rows={2} placeholder="Ej: Res. INDECOPI 123-2024" {...register("nota")} />
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
