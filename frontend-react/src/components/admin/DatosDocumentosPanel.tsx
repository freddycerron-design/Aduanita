import { useState } from "react";

import { useEstructuraDocumentos } from "@/hooks/useEstructuraDocumentos";
import { TIPOS_DOCUMENTO } from "@/lib/types";
import type { CampoEstructura, TipoDocumento } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NOMBRE_DOCUMENTO: Record<TipoDocumento, string> = {
  FACTURA: "Factura comercial",
  SEGURO: "Póliza de seguro",
  SWIFT_BANCARIO: "Transferencia bancaria (SWIFT)",
  BL: "Bill of Lading (BL)",
  PACKING_LIST: "Packing list",
};

function TablaCampos({ campos }: { campos: CampoEstructura[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Dato</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Presencia</TableHead>
          <TableHead>Nota</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {campos.map((c) => (
          <TableRow key={c.campo}>
            <TableCell className="font-medium text-texto">{c.etiqueta}</TableCell>
            <TableCell className="text-texto-secundario">{c.tipo_dato}</TableCell>
            <TableCell>
              <Badge variant={c.obligatorio ? "verde" : "neutral"}>{c.obligatorio ? "Siempre" : "Puede faltar"}</Badge>
            </TableCell>
            <TableCell className="text-xs text-texto-secundario">{c.descripcion ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Referencia de solo lectura: que datos extrae cada tipo de documento.
 * La cabecera es lo que una regla de validacion puede comparar; el detalle
 * (una fila por item) se extrae pero el motor de reglas no lo compara.
 */
export function DatosDocumentosPanel() {
  const { data: estructura, isLoading } = useEstructuraDocumentos();
  const [tipo, setTipo] = useState<TipoDocumento>("FACTURA");

  const documento = estructura?.[tipo];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tipo-documento-datos">Tipo de documento</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDocumento)}>
          <SelectTrigger id="tipo-documento-datos" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_DOCUMENTO.map((t) => (
              <SelectItem key={t} value={t}>
                {NOMBRE_DOCUMENTO[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading || !documento ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <div>
              <h2 className="text-sm font-semibold text-texto">Cabecera</h2>
              <p className="text-sm text-texto-secundario">
                Un valor por documento. Son los datos que puedes comparar en las reglas de validación.
              </p>
            </div>
            <TablaCampos campos={documento.cabecera} />
          </section>

          {documento.detalle.length === 0 ? (
            <section className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-texto">Detalle</h2>
              <p className="text-sm text-texto-secundario">Este documento no tiene detalle por ítem.</p>
            </section>
          ) : (
            documento.detalle.map((lista) => (
              <section key={lista.campo} className="flex flex-col gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-texto">Detalle ({lista.etiqueta.toLowerCase()})</h2>
                  <p className="text-sm text-texto-secundario">
                    Se extrae una fila por cada línea del documento. Estos datos se ven en la revisión, pero las
                    reglas de validación no los comparan.
                  </p>
                </div>
                <TablaCampos campos={lista.columnas} />
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
