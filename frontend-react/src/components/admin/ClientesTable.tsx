import { Pencil, Trash2 } from "lucide-react";

import { useEliminarCliente } from "@/hooks/useEliminarCliente";
import type { ClienteOut } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface ClientesTableProps {
  clientes: ClienteOut[];
  onEditar: (cliente: ClienteOut) => void;
}

const ETIQUETA_TIPO_PERSONA: Record<ClienteOut["tipo_persona"], string> = {
  NATURAL: "Natural",
  JURIDICA: "Jurídica",
};

/** Tabla de importadores registrados -- mismo patrón que las otras tablas
 * de Administración. Registrar un importador acá es lo que habilita su
 * portal: después se le vincula una cuenta con rol Cliente y sus
 * despachos. */
export function ClientesTable({ clientes, onEditar }: ClientesTableProps) {
  const eliminar = useEliminarCliente();

  function confirmarEliminar(cliente: ClienteOut) {
    if (
      window.confirm(
        `¿Eliminar a "${cliente.razon_social}"? Sus despachos NO se borran, pero dejan de verse en el portal, y sus cuentas de acceso al portal se eliminan.`,
      )
    ) {
      eliminar.mutate(cliente.id);
    }
  }

  if (clientes.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-4 text-sm text-texto-secundario">
        No hay importadores registrados todavía.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Código</TableHead>
          <TableHead>Razón social</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Documento</TableHead>
          <TableHead>Contacto</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {clientes.map((cliente) => (
          <TableRow key={cliente.id}>
            <TableCell className="whitespace-nowrap font-mono text-xs text-texto-secundario">
              {cliente.codigo ?? "—"}
            </TableCell>
            <TableCell className="font-semibold">{cliente.razon_social}</TableCell>
            <TableCell className="text-texto-secundario">
              {ETIQUETA_TIPO_PERSONA[cliente.tipo_persona]}
            </TableCell>
            <TableCell className="whitespace-nowrap font-mono text-xs text-texto-secundario">
              {cliente.tipo_documento} {cliente.numero_documento}
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span>{cliente.nombre_contacto ?? "—"}</span>
                {(cliente.telefono_contacto || cliente.email_contacto) && (
                  <span className="text-xs text-texto-secundario">
                    {[cliente.telefono_contacto, cliente.email_contacto].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={cliente.activo ? "verde" : "neutral"}>
                {cliente.activo ? "Activo" : "Inactivo"}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onEditar(cliente)}
                  aria-label={`Editar ${cliente.razon_social}`}
                  title="Editar"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => confirmarEliminar(cliente)}
                  disabled={eliminar.isPending}
                  aria-label={`Eliminar ${cliente.razon_social}`}
                  title="Eliminar"
                  className="text-rojo hover:bg-rojo/10 hover:text-rojo"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
