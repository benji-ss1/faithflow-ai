import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full px-3 py-2 text-sm rounded-md border border-border bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.30)] transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-[color-mix(in_oklab,var(--color-brand)_28%,var(--color-border))] focus-visible:outline-none focus-visible:border-[color-mix(in_oklab,var(--color-brand)_60%,var(--color-border))] focus-visible:shadow-[inset_0_1px_2px_rgba(0,0,0,0.30),0_0_0_3px_color-mix(in_oklab,var(--color-brand)_22%,transparent)]",
        className,
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
