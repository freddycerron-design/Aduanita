import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex items-center gap-6 border-b border-border", className)}
      {...props}
    />
  );
}

/** Tira de tabs clasica (subrayado), no botones tipo pill: el indicador de
 * "pestaña activa" es el borde inferior coral, no un fondo relleno. Un
 * trigger deshabilitado (ver ExploradorTab en `DespachoPage`, donde
 * Revisión/Clasificación/etc no tienen sentido sin un despacho elegido)
 * se ve atenuado e inerte -- Radix ya evita que se pueda activar por
 * click o teclado. */
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 border-transparent px-1 py-3",
        "text-sm font-semibold text-texto-secundario transition-colors",
        "hover:text-texto",
        "data-[state=active]:border-coral data-[state=active]:text-coral",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:text-texto-secundario/40",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "mt-4 focus-visible:outline-none data-[state=inactive]:hidden",
        "data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200",
        className,
      )}
      {...props}
    />
  );
}
