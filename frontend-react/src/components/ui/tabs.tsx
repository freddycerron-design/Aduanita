import type { ComponentProps, ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1",
        className,
      )}
      {...props}
    />
  );
}

/** `numero` dibuja el circulo coral con el numero de orden como un <span>
 * real dentro del trigger -- no un ::before inyectado sobre un testid
 * interno de una libreria de terceros (la causa del bug de numeracion que
 * tuvimos que depurar en la version Streamlit). */
export function TabsTrigger({
  className,
  numero,
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & { numero?: number }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-texto-secundario",
        "transition-colors data-[state=active]:bg-coral data-[state=active]:text-white",
        "hover:text-texto data-[state=active]:hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {numero !== undefined && (
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold",
            "bg-coral text-white transition-colors",
            "group-data-[state=active]:bg-white group-data-[state=active]:text-coral",
          )}
        >
          {numero}
        </span>
      )}
      {children as ReactNode}
    </TabsPrimitive.Trigger>
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
