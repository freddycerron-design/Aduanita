import type { TipoDocumento } from "@/lib/types";

/** Nombre legible de cada tipo de documento. El valor del enum
 * (`SWIFT_BANCARIO`, `PACKING_LIST`...) es un identificador interno y no
 * debe mostrarse al usuario. */
export const NOMBRE_DOCUMENTO: Record<TipoDocumento, string> = {
  FACTURA: "Factura comercial",
  SEGURO: "Póliza de seguro",
  SWIFT_BANCARIO: "Transferencia bancaria (SWIFT)",
  BL: "Bill of Lading (BL)",
  PACKING_LIST: "Packing list",
};

/** Versión corta para espacios angostos (tarjetas, pestañas). */
export const NOMBRE_DOCUMENTO_CORTO: Record<TipoDocumento, string> = {
  FACTURA: "Factura",
  SEGURO: "Seguro",
  SWIFT_BANCARIO: "SWIFT",
  BL: "BL",
  PACKING_LIST: "Packing list",
};
