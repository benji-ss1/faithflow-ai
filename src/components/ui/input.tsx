import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn("h-9 w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus-visible:outline-2 focus-visible:outline-ring", className)} {...props} />
  )
);
Input.displayName = "Input";
