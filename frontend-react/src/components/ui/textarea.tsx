import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex w-full rounded-lg border border-input bg-surface px-3.5 py-2.5 text-sm text-texto",
        "placeholder:text-texto-secundario outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
