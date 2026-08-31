import type { ComponentProps } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";

import { cn } from "@/lib/utils";

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn("flex flex-wrap gap-4", className)} {...props} />;
}

export function RadioGroupItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-texto">
      <RadioGroupPrimitive.Item
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border border-input",
          "text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "data-[state=checked]:border-coral",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator>
          <Circle className="size-2 fill-coral" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      {children}
    </label>
  );
}
