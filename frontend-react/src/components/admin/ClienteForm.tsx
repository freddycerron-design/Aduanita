import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { useGuardarCliente } from "@/hooks/useGuardarCliente";
import type { ClienteOut, ClienteUpsert, TipoDocumentoIdentidad, TipoPersona } from "@/lib/types";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface FormValues {
  razon_social: string;
  codigo: string;
  tipo_persona: TipoPersona;
  tipo_documento: TipoDocumentoIdentidad;
  numero_documento: string;
  direccion_calle: string;
  distrito: string;
  departamento: string;
  pais: string;
  nombre_contacto: string;
  telefono_contacto: string;
  email_contacto: string;
  activo: boolean;
}

function valoresIniciales(importador: ClienteOut | null): FormValues {
  return {
    razon_social: importador?.razon_social ?? "",
    codigo: importador?.codigo ?? "",
    tipo_persona: importador?.tipo_persona ?? "JURIDICA",
    tipo_documento: importador?.tipo_documento ?? "RUC",
    numero_documento: importador?.numero_documento ?? "",
    direccion_calle: importador?.direccion_calle ?? "",
    distrito: importador?.distrito ?? "",
    departamento: importador?.departamento ?? "",
    pais: importador?.pais ?? "Perú",
    nombre_contacto: importador?.nombre_contacto ?? "",
    telefono_contacto: importador?.telefono_contacto ?? "",
    email_contacto: importador?.email_contacto ?? "",
    activo: importador?.activo ?? true,
  };
}

/** "" -> null: un campo opcional vacío significa "sin dato", no una
 * cadena vacía guardada -- misma convención que el resto del app. */
function vacioANulo(texto: string): string | null {
  return texto.trim() || null;
}

function aRequest(v: FormValues): ClienteUpsert {
  return {
    razon_social: v.razon_social.trim(),
    codigo: vacioANulo(v.codigo),
    tipo_persona: v.tipo_persona,
    tipo_documento: v.tipo_documento,
    numero_documento: v.numero_documento.trim(),
    direccion_calle: vacioANulo(v.direccion_calle),
    distrito: vacioANulo(v.distrito),
    departamento: vacioANulo(v.departamento),
    pais: vacioANulo(v.pais),
    nombre_contacto: vacioANulo(v.nombre_contacto),
    telefono_contacto: vacioANulo(v.telefono_contacto),
    email_contacto: vacioANulo(v.email_contacto),
    activo: v.activo,
  };
}

export interface ClienteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = crear un importador nuevo; uno existente = editarlo. */
  cliente: ClienteOut | null;
}

/** Modal de crear/editar un importador -- mismo patrón de diálogo que el
 * resto de Administración, con los campos del mantenimiento completo
 * (identificación, dirección, contacto). */
export function ClienteForm({ open, onOpenChange, cliente }: ClienteFormProps) {
  const guardar = useGuardarCliente();
  const { register, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
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
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente ? "Editar importador" : "Nuevo importador"}</DialogTitle>
          <DialogDescription>
            El importador dueño de los despachos. Registrarlo acá permite vincularle despachos y darle
            acceso al portal con una cuenta de rol Cliente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="importador-razon">Razón social / Nombre</Label>
              <Input id="importador-razon" required {...register("razon_social")} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="importador-codigo">Código (opcional)</Label>
              <Input id="importador-codigo" className="font-mono" {...register("codigo")} />
            </div>

            <div className="flex items-center gap-2 sm:pt-7">
              <input
                id="importador-activo"
                type="checkbox"
                className="size-4 rounded border-border"
                {...register("activo")}
              />
              <Label htmlFor="importador-activo" className="font-normal">
                Importador activo
              </Label>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-2">
              <Label>Tipo</Label>
              <RadioGroup
                value={watch("tipo_persona")}
                onValueChange={(v) => setValue("tipo_persona", v as TipoPersona)}
              >
                <RadioGroupItem value="NATURAL">Persona natural</RadioGroupItem>
                <RadioGroupItem value="JURIDICA">Persona jurídica</RadioGroupItem>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Tipo de documento</Label>
                <RadioGroup
                  value={watch("tipo_documento")}
                  onValueChange={(v) => setValue("tipo_documento", v as TipoDocumentoIdentidad)}
                >
                  <RadioGroupItem value="DNI">DNI</RadioGroupItem>
                  <RadioGroupItem value="RUC">RUC</RadioGroupItem>
                </RadioGroup>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="importador-documento">Número de documento</Label>
                <Input
                  id="importador-documento"
                  className="font-mono"
                  required
                  {...register("numero_documento")}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-texto-secundario">Dirección</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="importador-calle">Calle y número</Label>
              <Input id="importador-calle" placeholder="Av. Larco 123" {...register("direccion_calle")} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="importador-distrito">Distrito</Label>
                <Input id="importador-distrito" {...register("distrito")} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="importador-departamento">Departamento</Label>
                <Input id="importador-departamento" {...register("departamento")} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="importador-pais">País</Label>
                <Input id="importador-pais" {...register("pais")} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-texto-secundario">Contacto</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="importador-nombre-contacto">Nombre de contacto</Label>
                <Input id="importador-nombre-contacto" {...register("nombre_contacto")} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="importador-telefono">Teléfono de contacto</Label>
                <Input id="importador-telefono" type="tel" {...register("telefono_contacto")} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="importador-correo">Correo de contacto</Label>
                <Input id="importador-correo" type="email" {...register("email_contacto")} />
              </div>
            </div>
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
