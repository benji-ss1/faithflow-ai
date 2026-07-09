import * as React from "react";
import { cn } from "@/lib/utils";
export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("border border-border bg-card rounded-md", className)} {...props} />
);
