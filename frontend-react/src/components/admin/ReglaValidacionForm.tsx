import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { useGuardarReglaValidacion } from "@/hooks/useGuardarReglaValidacion";
import { TIPOS_DOCUMENTO } from "@/lib/types";
import type { ReglaValidacionOut, ReglaValidacionUpsert, Severidad, TipoComparacion } from "@/lib/types";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

const SEVERIDADES: Severidad[] = ["ALTA", "MEDIA", "NINGUNA"];
const TIPOS_COMPARACION: { valor: TipoComparacion; etiqueta: string }[] = [
  { valor: "RANGO_ASIMETRICO", etiqueta: "Rango asimétrico (numérico)" },
  { valor: "IGUALDAD_EXACTA", etiqueta: "Igualdad exacta" },
  { valor: "TEXTO_FUZZY", etiqueta: "Texto difuso (razón social)" },
];

/** Valores del formulario tal cual los maneja react-hook-form: todos los
 * parametros posibles de los 3 tipos de comparacion viven juntos aca (mas
 * simple que una union discriminada en el form), y solo se ensamblan al
 * shape correcto de `parametros` para el request en `aRequest()`. */
interface FormValues {
  codigo: string;
  nombre: string;
  descripcion: string;
  activo: boolean;
  documento_a: string;
  campo_a: string;
  documento_b: string;
  campo_b: string;
  campo_moneda_a: string;
  campo_moneda_b: string;
  severidad_moneda_distinta: Severidad;
  severidad_dato_faltante: Severidad;
  tipo_comparacion: TipoComparacion;
  umbral_inferior: string;
  severidad_inferior: Severidad;
  umbral_superior: string;
  severidad_superior: Severidad;
  severidad_si_distinto: Severidad;
  normalizar_texto: boolean;
  umbral_similitud: string;
}

function valoresIniciales(regla: ReglaValidacionOut | null): FormValues {
  const p = (regla?.parametros ?? {}) as Record<string, unknown>;
  return {
    codigo: regla?.codigo ?? "",
    nombre: regla?.nombre ?? "",
    descripcion: regla?.descripcion ?? "",
    activo: regla?.activo ?? true,
    documento_a: regla?.documento_a ?? "FACTURA",
    campo_a: regla?.campo_a ?? "",
    documento_b: regla?.documento_b ?? "BL",
    campo_b: regla?.campo_b ?? "",
    campo_moneda_a: regla?.campo_moneda_a ?? "",
    campo_moneda_b: regla?.campo_moneda_b ?? "",
    severidad_moneda_distinta: regla?.severidad_moneda_distinta ?? "MEDIA",
    severidad_dato_faltante: regla?.severidad_dato_faltante ?? "MEDIA",
    tipo_comparacion: regla?.tipo_comparacion ?? "RANGO_ASIMETRICO",
    umbral_inferior: typeof p.umbral_inferior === "number" ? String(p.umbral_inferior) : "",
    severidad_inferior: (p.severidad_inferior as Severidad) ?? "ALTA",
    umbral_superior: typeof p.umbral_superior === "number" ? String(p.umbral_superior) : "",
    severidad_superior: (p.severidad_superior as Severidad) ?? "ALTA",
    severidad_si_distinto: (p.severidad_si_distinto as Severidad) ?? "ALTA",
    normalizar_texto: typeof p.normalizar_texto === "boolean" ? p.normalizar_texto : false,
    umbral_similitud: typeof p.umbral_similitud === "number" ? String(p.umbral_similitud) : "0.9",
  };
}

function aRequest(v: FormValues): ReglaValidacionUpsert {
  const parametros: Record<string, unknown> =
    v.tipo_comparacion === "RANGO_ASIMETRICO"
      ? {
          umbral_inferior: Number(v.umbral_inferior),
          severidad_inferior: v.severidad_inferior,
          umbral_superior: Number(v.umbral_superior),
          severidad_superior: v.severidad_superior,
        }
      : v.tipo_comparacion === "IGUALDAD_EXACTA"
        ? { severidad_si_distinto: v.severidad_si_distinto, normalizar_texto: v.normalizar_texto }
        : { umbral_similitud: Number(v.umbral_similitud), severidad_si_distinto: v.severidad_si_distinto };

  return {
    codigo: v.codigo.trim(),
    nombre: v.nombre.trim(),
    descripcion: v.descripcion.trim() || null,
    activo: v.activo,
    documento_a: v.documento_a as ReglaValidacionUpsert["documento_a"],
    campo_a: v.campo_a.trim(),
    documento_b: v.documento_b as ReglaValidacionUpsert["documento_b"],
    campo_b: v.campo_b.trim(),
    campo_moneda_a: v.campo_moneda_a.trim() || null,
    campo_moneda_b: v.campo_moneda_b.trim() || null,
    severidad_moneda_distinta: v.campo_moneda_a.trim() ? v.severidad_moneda_distinta : null,
    severidad_dato_faltante: v.severidad_dato_faltante,
    tipo_comparacion: v.tipo_comparacion,
    parametros,
  };
}

function SelectSeveridad({
  value,
  onChange,
  id,
}: {
  value: Severidad;
  onChange: (valor: Severidad) => void;
  id: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Severidad)}>
      <SelectTrigger id={id} className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SEVERIDADES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface ReglaValidacionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = crear una regla nueva; una regla existente = editarla. */
  regla: ReglaValidacionOut | null;
}

/**
 * Modal de crear/editar una regla de validacion. Los campos comunes son
 * fijos; el bloque de "parametros" cambia segun `tipo_comparacion`
 * elegido (los 3 tipos que interpreta el motor generico, ver
 * services/validation_engine.py). La existencia real de `campo_a`/
 * `campo_b` en el schema Pydantic del documento elegido la valida el
 * backend al guardar -- no se duplica esa lista aca, un campo invalido
 * se muestra como toast de error.
 */
export function ReglaValidacionForm({ open, onOpenChange, regla }: ReglaValidacionFormProps) {
  const guardar = useGuardarReglaValidacion();
  const [errorMoneda, setErrorMoneda] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: valoresIniciales(regla),
  });

  // Radix Dialog no monta <DialogContent> mientras open=false, pero por
  // las dudas (y para re-sincronizar si `regla` cambia con el dialog ya
  // abierto) se resetea explicitamente cada vez que cambia el objetivo.
  useEffect(() => {
    reset(valoresIniciales(regla));
    setErrorMoneda(null);
  }, [regla, reset]);

  const tipoComparacion = watch("tipo_comparacion");
  const campoMonedaA = watch("campo_moneda_a");

  function onSubmit(v: FormValues) {
    const tieneMonedaA = v.campo_moneda_a.trim() !== "";
    const tieneMonedaB = v.campo_moneda_b.trim() !== "";
    if (tieneMonedaA !== tieneMonedaB) {
      setErrorMoneda("campo_moneda_a y campo_moneda_b deben venir juntos (ambos vacíos o ambos completos).");
      return;
    }
    setErrorMoneda(null);
    guardar.mutate(
      { id: regla?.id, datos: aRequest(v) },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{regla ? "Editar regla" : "Nueva regla de validación"}</DialogTitle>
          <DialogDescription>
            Compara un campo de un documento contra un campo de otro. El código es el identificador que
            queda en los hallazgos de la revisión.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="codigo">Código</Label>
              <Input id="codigo" className="font-mono" required {...register("codigo")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" required {...register("nombre")} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Textarea id="descripcion" rows={2} {...register("descripcion")} />
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Documento A</Label>
              <Select value={watch("documento_a")} onValueChange={(v) => setValue("documento_a", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_DOCUMENTO.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campo_a">Campo de A</Label>
              <Input id="campo_a" className="font-mono" placeholder="p.ej. peso_bruto_kg" required {...register("campo_a")} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Documento B</Label>
              <Select value={watch("documento_b")} onValueChange={(v) => setValue("documento_b", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_DOCUMENTO.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campo_b">Campo de B</Label>
              <Input id="campo_b" className="font-mono" placeholder="p.ej. peso_bruto_kg" required {...register("campo_b")} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="severidad_dato_faltante">Severidad si falta un dato</Label>
            <SelectSeveridad
              id="severidad_dato_faltante"
              value={watch("severidad_dato_faltante")}
              onChange={(v) => setValue("severidad_dato_faltante", v)}
            />
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <Label>Tipo de comparación</Label>
            <Select
              value={tipoComparacion}
              onValueChange={(v) => setValue("tipo_comparacion", v as TipoComparacion)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_COMPARACION.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tipoComparacion === "RANGO_ASIMETRICO" && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
              <p className="text-xs text-texto-secundario">
                Compara la diferencia relativa de B respecto de A. Por debajo del umbral inferior o por
                encima del superior, dispara la severidad correspondiente; en el medio, sin hallazgo.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="umbral_inferior">Umbral inferior</Label>
                  <Input id="umbral_inferior" type="number" step="any" required {...register("umbral_inferior")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Severidad si es menor</Label>
                  <SelectSeveridad
                    id="severidad_inferior"
                    value={watch("severidad_inferior")}
                    onChange={(v) => setValue("severidad_inferior", v)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="umbral_superior">Umbral superior</Label>
                  <Input id="umbral_superior" type="number" step="any" required {...register("umbral_superior")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Severidad si es mayor</Label>
                  <SelectSeveridad
                    id="severidad_superior"
                    value={watch("severidad_superior")}
                    onChange={(v) => setValue("severidad_superior", v)}
                  />
                </div>
              </div>
            </div>
          )}

          {tipoComparacion === "IGUALDAD_EXACTA" && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-col gap-1.5">
                <Label>Severidad si distinto</Label>
                <SelectSeveridad
                  id="severidad_si_distinto"
                  value={watch("severidad_si_distinto")}
                  onChange={(v) => setValue("severidad_si_distinto", v)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-texto">
                <input type="checkbox" className="accent-coral" {...register("normalizar_texto")} />
                Normalizar texto (mayúsculas + espacios) antes de comparar
              </label>
            </div>
          )}

          {tipoComparacion === "TEXTO_FUZZY" && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="umbral_similitud">Umbral de similitud (0–1)</Label>
                  <Input
                    id="umbral_similitud"
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    required
                    {...register("umbral_similitud")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Severidad si distinto</Label>
                  <SelectSeveridad
                    id="severidad_si_distinto"
                    value={watch("severidad_si_distinto")}
                    onChange={(v) => setValue("severidad_si_distinto", v)}
                  />
                </div>
              </div>
            </div>
          )}

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campo_moneda_a">Campo moneda A (opcional)</Label>
              <Input id="campo_moneda_a" className="font-mono" placeholder="p.ej. moneda" {...register("campo_moneda_a")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campo_moneda_b">Campo moneda B (opcional)</Label>
              <Input id="campo_moneda_b" className="font-mono" placeholder="p.ej. moneda" {...register("campo_moneda_b")} />
            </div>
          </div>
          {campoMonedaA.trim() !== "" && (
            <div className="flex flex-col gap-1.5">
              <Label>Severidad si la moneda difiere</Label>
              <SelectSeveridad
                id="severidad_moneda_distinta"
                value={watch("severidad_moneda_distinta")}
                onChange={(v) => setValue("severidad_moneda_distinta", v)}
              />
            </div>
          )}
          {errorMoneda && <p className="text-sm text-rojo">{errorMoneda}</p>}

          <label className="flex items-center gap-2 text-sm text-texto">
            <input type="checkbox" className="accent-coral" {...register("activo")} />
            Regla activa
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
