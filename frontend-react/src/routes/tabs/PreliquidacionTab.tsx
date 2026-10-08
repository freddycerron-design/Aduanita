import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { useProfile } from "@/hooks/useProfile";
import { usePreliquidacion } from "@/hooks/usePreliquidacion";
import { useCalcularPreliquidacion } from "@/hooks/useCalcularPreliquidacion";
import { puedeCalcularPreliquidacion } from "@/lib/roles";
import type { DocumentoExtraidoOut, FacturaContenido, PreliquidacionOut } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export interface PreliquidacionTabProps {
  idDespacho: string;
  documentos: DocumentoExtraidoOut[];
}

/** Estima un Valor CIF de partida a partir de los documentos ya cargados,
 * solo como sugerencia editable -- no hay campo de flete en ningun
 * schema todavia, asi que esto es lo mejor que se puede inferir sin
 * pedirselo al especialista a mano:
 * - Si la factura ya declara un incoterm CIF, su monto_total ya ES el
 *   valor CIF.
 * - Si no (CPT, FOB, EXW...), se suma el valor asegurado de la poliza de
 *   seguro (si existe) como aproximacion del componente de seguro. */
function sugerirValorCif(documentos: DocumentoExtraidoOut[]): number | null {
  const factura = documentos.find((d) => d.tipo_documento === "FACTURA")?.contenido_json as
    | FacturaContenido
    | undefined;
  if (!factura?.monto_total) return null;

  const esCif = factura.incoterm?.toUpperCase().includes("CIF") ?? false;
  if (esCif) return factura.monto_total;

  const seguro = documentos.find((d) => d.tipo_documento === "SEGURO")?.contenido_json as
    | { valor_asegurado?: number }
    | undefined;
  return factura.monto_total + (seguro?.valor_asegurado ?? 0);
}

/**
 * Pestaña 3: cálculo de Ad Valorem, IGV, IPM, antidumping y derecho
 * específico según la subpartida ya determinada (por la IA o por la
 * decisión del liquidador). El Valor CIF es un campo editable con una
 * sugerencia precalculada (ver `sugerirValorCif`) -- no se calcula 100%
 * solo porque ningún documento trae un campo de flete todavía.
 */
export function PreliquidacionTab({ idDespacho, documentos }: PreliquidacionTabProps) {
  const { data: perfil } = useProfile();
  const { data, isLoading, isError, error } = usePreliquidacion(idDespacho);
  const calcular = useCalcularPreliquidacion(idDespacho);

  const [valorCif, setValorCif] = useState("");
  // No editable: sale del cálculo guardado o de la moneda de la factura
  // (el Valor CIF se arma con montos de la factura, así que su moneda es
  // la de ella). Cambiarla a mano rompería esa coherencia.
  const [moneda, setMoneda] = useState("USD");
  const [antidumping, setAntidumping] = useState("0");
  const [derechoEspecifico, setDerechoEspecifico] = useState("0");
  const [inicializado, setInicializado] = useState(false);

  // Precarga el formulario una sola vez, cuando llegan los datos: si ya
  // hay un snapshot calculado se usa tal cual (para poder ajustar y
  // recalcular), si no se arma con la sugerencia de CIF + el default de
  // cargos_especiales_arancel para la subpartida.
  useEffect(() => {
    if (!data || inicializado) return;
    if (data.preliquidacion) {
      setValorCif(dosDecimales(data.preliquidacion.valor_cif));
      setMoneda(data.preliquidacion.moneda);
      setAntidumping(dosDecimales(data.preliquidacion.antidumping_monto));
      setDerechoEspecifico(dosDecimales(data.preliquidacion.derecho_especifico_monto));
    } else {
      const sugerido = sugerirValorCif(documentos);
      if (sugerido !== null) setValorCif(dosDecimales(sugerido));
      const monedaFactura = documentos.find((d) => d.tipo_documento === "FACTURA")?.contenido_json.moneda;
      if (typeof monedaFactura === "string" && monedaFactura.trim()) setMoneda(monedaFactura.trim().toUpperCase());
      else if (data.cargo_especial_default) setMoneda(data.cargo_especial_default.moneda);
      setAntidumping(dosDecimales(data.cargo_especial_default?.antidumping_monto ?? 0));
      setDerechoEspecifico(dosDecimales(data.cargo_especial_default?.derecho_especifico_monto ?? 0));
    }
    setInicializado(true);
  }, [data, documentos, inicializado]);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (isError) {
    return (
      <p className="text-sm text-rojo">
        No se pudo cargar la preliquidación{error instanceof Error ? `: ${error.message}` : "."}
      </p>
    );
  }

  if (!data?.subpartida_vigente) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
        Aún no hay una subpartida determinada. Completa la pestaña Preclasificación primero.
      </p>
    );
  }

  const puedeCalcular = puedeCalcularPreliquidacion(perfil?.rol);
  const resultado = data.preliquidacion;

  function manejarSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    calcular.mutate({
      valor_cif: Number(valorCif),
      moneda,
      antidumping_monto: Number(antidumping),
      derecho_especifico_monto: Number(derechoEspecifico),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-texto">Cálculo de tributos</h2>
          <p className="text-[13px] text-texto-secundario">
            Subpartida vigente: <span className="font-mono font-semibold text-texto">{data.subpartida_vigente}</span>
            . El Valor CIF viene precargado con una sugerencia calculada de la Factura y el Seguro (o el CIF
            directo si el incoterm ya es CIF) -- revísalo y corrígelo antes de calcular.
          </p>
        </div>

        {puedeCalcular ? (
          <form
            onSubmit={manejarSubmit}
            className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-5"
          >
            <CampoMonto id="pre-valor-cif" etiqueta="Valor CIF" valor={valorCif} onCambiar={setValorCif} requerido />
            <div className="flex w-24 flex-col gap-2">
              <Label htmlFor="pre-moneda">Moneda</Label>
              <Input id="pre-moneda" value={moneda} readOnly tabIndex={-1} className="cursor-default bg-bg text-texto-secundario" />
            </div>
            <CampoMonto id="pre-antidumping" etiqueta="Antidumping" valor={antidumping} onCambiar={setAntidumping} />
            <CampoMonto
              id="pre-derecho"
              etiqueta="Derecho específico"
              valor={derechoEspecifico}
              onCambiar={setDerechoEspecifico}
            />
            <Button type="submit" disabled={calcular.isPending}>
              {calcular.isPending && <Loader2 className="animate-spin" />}
              {calcular.isPending ? "Calculando..." : "Calcular"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-texto-secundario">
            Solo un especialista o liquidador puede calcular la preliquidación.
          </p>
        )}
      </section>

      {resultado && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-texto">Resultado</h2>
          <TablaResultado resultado={resultado} />
          <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-amber">
            Antidumping y derecho específico requieren verificación caso a caso (INDECOPI/MEF) -- los valores
            de arriba son sugerencias, no una tasa vigente garantizada.
          </p>
        </section>
      )}
    </div>
  );
}

const formatoMonto = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor de un input numérico con 2 decimales ("1250" -> "1250.00"). Sin
 * separador de miles: es lo que acepta un <input type="number">. */
function dosDecimales(valor: number | string): string {
  const numero = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : String(valor);
}

/** Campo de monto angosto: se escribe libre y al salir del campo queda
 * con 2 decimales. */
function CampoMonto({
  id,
  etiqueta,
  valor,
  onCambiar,
  requerido = false,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onCambiar: (valor: string) => void;
  requerido?: boolean;
}) {
  return (
    <div className="flex w-40 flex-col gap-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        type="number"
        step="0.01"
        min="0"
        required={requerido}
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        onBlur={() => valor !== "" && onCambiar(dosDecimales(valor))}
        className="text-right tabular-nums"
      />
    </div>
  );
}

/** `2026-10-08` -> `08/10/2026` sin pasar por Date (evita el corrimiento
 * de un día por zona horaria). */
function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

/**
 * Montos en la moneda del Valor CIF y, al lado, en soles con el tipo de
 * cambio venta SUNAT que quedó guardado en el snapshot al calcular (si
 * después se corrige la tabla de tipos de cambio, esto no cambia solo:
 * hay que recalcular). La columna en soles no se muestra si la moneda ya
 * es PEN.
 */
function TablaResultado({ resultado }: { resultado: PreliquidacionOut }) {
  const moneda = resultado.moneda.toUpperCase();
  const enSoles = moneda === "PEN" || moneda === "S/";
  const tipoCambio = resultado.tipo_cambio_venta;
  const fechaCalculo = resultado.actualizado_en.slice(0, 10);

  // `tasa` solo en los conceptos que se calculan como porcentaje.
  const filas: { etiqueta: string; tasa?: number; valor: number; total?: boolean }[] = [
    { etiqueta: "Valor CIF", valor: resultado.valor_cif },
    { etiqueta: "Ad Valorem", tasa: resultado.ad_valorem_tasa, valor: resultado.ad_valorem_monto },
    { etiqueta: "Base IGV/IPM", valor: resultado.base_igv_ipm },
    { etiqueta: "IGV", tasa: 16, valor: resultado.igv_monto },
    { etiqueta: "IPM", tasa: 2, valor: resultado.ipm_monto },
    { etiqueta: "Antidumping", valor: resultado.antidumping_monto },
    { etiqueta: "Derecho específico", valor: resultado.derecho_especifico_monto },
    { etiqueta: "Total tributos", valor: resultado.total_tributos, total: true },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[13px] text-texto-secundario">
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Concepto
              </th>
              <th scope="col" className="w-20 px-4 py-2.5 text-right font-medium">
                %
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {resultado.moneda}
              </th>
              {!enSoles && (
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Soles (S/)
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr
                key={fila.etiqueta}
                className={
                  fila.total
                    ? "border-t border-border bg-surface font-semibold text-texto"
                    : "border-t border-border first:border-t-0"
                }
              >
                <td className={fila.total ? "px-4 py-3" : "px-4 py-2.5 text-texto-secundario"}>{fila.etiqueta}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-texto-secundario">
                  {fila.tasa === undefined ? "" : `${fila.tasa}%`}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-texto">
                  {formatoMonto.format(fila.valor)}
                </td>
                {!enSoles && (
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-texto">
                    {tipoCambio === null ? "—" : formatoMonto.format(fila.valor * tipoCambio)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!enSoles &&
        (tipoCambio !== null && resultado.fecha_tipo_cambio ? (
          <p className="text-[13px] text-texto-secundario">
            Tipo de cambio venta SUNAT del {formatearFecha(resultado.fecha_tipo_cambio)}:{" "}
            <span className="font-mono font-semibold text-texto">S/ {tipoCambio.toFixed(3)}</span>
            {resultado.fecha_tipo_cambio !== fechaCalculo &&
              " (último publicado antes de la fecha del cálculo)"}
            .
          </p>
        ) : (
          <p className="text-[13px] text-amber">
            {moneda === "USD"
              ? "No hay tipo de cambio disponible (SUNAT no respondió y no hay uno guardado). Cárgalo en Configuración > Tipo de cambio y vuelve a calcular."
              : `SUNAT solo publica el tipo de cambio del dólar: los montos en ${resultado.moneda} no se convierten a soles.`}
          </p>
        ))}
    </div>
  );
}
