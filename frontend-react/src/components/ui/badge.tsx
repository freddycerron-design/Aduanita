import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-badge px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
  {
    variants: {
      variant: {
        neutral: "bg-surface-border text-texto-secundario",
        indigo: "bg-indigo/30 text-texto border border-indigo",
        amber: "bg-amber/15 text-amber border border-amber/40",
        verde: "bg-verde/15 text-verde border border-verde/40",
        rojo: "bg-rojo/15 text-rojo border border-rojo/40",
        coral: "bg-coral/15 text-coral border border-coral/40",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
