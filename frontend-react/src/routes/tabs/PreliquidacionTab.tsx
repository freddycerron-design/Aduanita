import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { useProfile } from "@/hooks/useProfile";
import { usePreliquidacion } from "@/hooks/usePreliquidacion";
import { useCalcularPreliquidacion } from "@/hooks/useCalcularPreliquidacion";
import { puedeCalcularPreliquidacion } from "@/lib/roles";
import type { DocumentoExtraidoOut, FacturaContenido } from "@/lib/types";
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
      setValorCif(String(data.preliquidacion.valor_cif));
      setMoneda(data.preliquidacion.moneda);
      setAntidumping(String(data.preliquidacion.antidumping_monto));
      setDerechoEspecifico(String(data.preliquidacion.derecho_especifico_monto));
    } else {
      const sugerido = sugerirValorCif(documentos);
      if (sugerido !== null) setValorCif(sugerido.toFixed(2));
      if (data.cargo_especial_default) {
        setAntidumping(String(data.cargo_especial_default.antidumping_monto));
        setDerechoEspecifico(String(data.cargo_especial_default.derecho_especifico_monto));
        setMoneda(data.cargo_especial_default.moneda);
      }
    }
    setInicializado(true);
  }, [data, documentos, inicializado]);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (isError) {
    return (
      <p className="text-sm text-rojo">
        No se pudo cargar la pre-liquidación{error instanceof Error ? `: ${error.message}` : "."}
      </p>
    );
  }

  if (!data?.subpartida_vigente) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
        Aún no hay una subpartida determinada. Completa la pestaña Clasificación primero.
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
          <p className="text-xs text-texto-secundario">
            Subpartida vigente: <span className="font-mono font-semibold text-texto">{data.subpartida_vigente}</span>
            . El Valor CIF viene precargado con una sugerencia calculada de la Factura y el Seguro (o el CIF
            directo si el incoterm ya es CIF) -- revísalo y corrígelo antes de calcular.
          </p>
        </div>

        {puedeCalcular ? (
          <form onSubmit={manejarSubmit} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-valor-cif">Valor CIF</Label>
                <Input
                  id="pre-valor-cif"
                  type="number"
                  step="0.01"
                  required
                  value={valorCif}
                  onChange={(e) => setValorCif(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-moneda">Moneda</Label>
                <Input id="pre-moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-antidumping">Antidumping</Label>
                <Input
                  id="pre-antidumping"
                  type="number"
                  step="0.01"
                  value={antidumping}
                  onChange={(e) => setAntidumping(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-derecho">Derecho específico</Label>
                <Input
                  id="pre-derecho"
                  type="number"
                  step="0.01"
                  value={derechoEspecifico}
                  onChange={(e) => setDerechoEspecifico(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Button type="submit" disabled={calcular.isPending}>
                {calcular.isPending && <Loader2 className="animate-spin" />}
                {calcular.isPending ? "Calculando..." : "Calcular"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-texto-secundario">
            Solo un especialista o liquidador puede calcular la pre-liquidación.
          </p>
        )}
      </section>

      {resultado && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-texto">Resultado</h2>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <tbody>
                <FilaResultado etiqueta="Valor CIF" valor={resultado.valor_cif} moneda={resultado.moneda} />
                <FilaResultado
                  etiqueta={`Ad Valorem (${resultado.ad_valorem_tasa}%)`}
                  valor={resultado.ad_valorem_monto}
                  moneda={resultado.moneda}
                />
                <FilaResultado etiqueta="Base IGV/IPM" valor={resultado.base_igv_ipm} moneda={resultado.moneda} />
                <FilaResultado etiqueta="IGV (16%)" valor={resultado.igv_monto} moneda={resultado.moneda} />
                <FilaResultado etiqueta="IPM (2%)" valor={resultado.ipm_monto} moneda={resultado.moneda} />
                <FilaResultado etiqueta="Antidumping" valor={resultado.antidumping_monto} moneda={resultado.moneda} />
                <FilaResultado
                  etiqueta="Derecho específico"
                  valor={resultado.derecho_especifico_monto}
                  moneda={resultado.moneda}
                />
                <tr className="border-t border-border bg-surface font-semibold text-texto">
                  <td className="px-4 py-3">Total tributos</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {resultado.moneda} {resultado.total_tributos.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-xs leading-relaxed text-amber">
            Antidumping y derecho específico requieren verificación caso a caso (INDECOPI/MEF) -- los valores
            de arriba son sugerencias, no una tasa vigente garantizada. No se aplica tipo de cambio: todos los
            montos quedan en la moneda del Valor CIF.
          </p>
        </section>
      )}
    </div>
  );
}

function FilaResultado({ etiqueta, valor, moneda }: { etiqueta: string; valor: number; moneda: string }) {
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className="px-4 py-2.5 text-texto-secundario">{etiqueta}</td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-texto">
        {moneda} {valor.toFixed(2)}
      </td>
    </tr>
  );
}
