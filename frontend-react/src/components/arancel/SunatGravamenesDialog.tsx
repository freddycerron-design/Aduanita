import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";

import { consultarGravamenesSunat } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { SubpartidaArancelaria } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export interface SunatGravamenesDialogProps {
  /** `null` = cerrado. */
  partida: SubpartidaArancelaria | null;
  onClose: () => void;
}

/**
 * Gravámenes vigentes de una subpartida consultados en vivo en SUNAT
 * (el backend replica la consulta del portal, que no se puede abrir con un
 * link directo). Se compara contra el ad valorem del arancel 2022 cargado,
 * que es el que podría estar desactualizado.
 */
export function SunatGravamenesDialog({ partida, onClose }: SunatGravamenesDialogProps) {
  const codigo = partida?.codigo ?? "";
  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.arancel.sunat(codigo),
    queryFn: () => consultarGravamenesSunat(codigo),
    enabled: codigo !== "",
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const adValoremSunat = data?.gravamenes.find((g) => g.concepto === "Ad Valorem")?.valor;
  const adValoremLocal = partida && partida.ad_valorem !== null ? `${partida.ad_valorem}%` : null;
  const difiere = adValoremSunat !== undefined && adValoremLocal !== null && adValoremSunat !== adValoremLocal;

  return (
    <Dialog open={partida !== null} onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Gravámenes vigentes en SUNAT · <span className="font-mono">{codigo}</span>
          </DialogTitle>
          <DialogDescription>
            Consultado en este momento en el portal de aranceles de SUNAT.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-texto-secundario">
            <Loader2 className="size-4 animate-spin" />
            Consultando SUNAT...
          </p>
        ) : isError ? (
          <p className="rounded-xl border border-rojo/40 bg-rojo/10 px-4 py-3 text-sm text-rojo">
            {error instanceof Error ? error.message : "No se pudo consultar SUNAT."} Puedes intentar de nuevo
            más tarde o consultarla directamente en el portal.
          </p>
        ) : data ? (
          <div className="flex flex-col gap-3">
            {data.tipo_producto && (
              <p className="text-xs text-texto-secundario">
                Tipo de producto: <span className="text-texto">{data.tipo_producto}</span>
              </p>
            )}
            <Table>
              <TableBody>
                {data.gravamenes.map((g) => (
                  <TableRow key={g.concepto}>
                    <TableCell className="text-sm">{g.concepto}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{g.valor}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {difiere && (
              <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-xs text-amber">
                El ad valorem vigente ({adValoremSunat}) es distinto al del arancel 2022 cargado en Aduafy (
                {adValoremLocal}). Usa el de SUNAT.
              </p>
            )}
            {data.gravamenes.some((g) => g.concepto === "Derecho antidumping" && g.valor === "Aplica") && (
              <p className="text-xs text-texto-secundario">
                El derecho antidumping depende del país de origen; revisa el detalle en SUNAT.
              </p>
            )}
          </div>
        ) : null}

        <div className="mt-4">
          <a
            href={data?.url_consulta ?? "http://www.aduanet.gob.pe/itarancel/arancelS01Alias"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-coral hover:underline"
          >
            <ExternalLink className="size-4" />
            Abrir el portal de SUNAT (buscar {codigo.replace(/\./g, "")})
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
