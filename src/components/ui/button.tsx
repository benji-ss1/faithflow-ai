import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Design Language v2 (2026-08-27): buttons carry real weight + motion. Every
// variant uses the house spring easing, lifts a hair on hover, and presses in on
// click. Filled variants get a lit top-edge (--edge-top) + depth shadow; the
// brand/live variants ride an ember gradient with a warm glow so the primary
// action always reads as the hottest thing on the surface.
const buttonVariants = cva(
  "group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold tracking-[-0.01em] transition-[transform,box-shadow,background,opacity] duration-200 [transition-timing-function:var(--ease-spring)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none motion-safe:hover:-translate-y-px active:translate-y-0 active:scale-[0.97] active:duration-75 focus-visible:outline-none",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-lg)] hover:brightness-105",
        secondary:
          "bg-secondary text-foreground shadow-[var(--edge-top),var(--shadow-sm)] hover:bg-accent hover:shadow-[var(--edge-top),var(--shadow-md)]",
        outline:
          "border border-border bg-[var(--color-card)] shadow-[var(--edge-top)] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:bg-accent hover:shadow-[var(--edge-top),var(--shadow-md)]",
        ghost:
          "shadow-none hover:bg-accent hover:shadow-[var(--edge-top)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--edge-top),var(--shadow-md)] hover:brightness-110 hover:shadow-[var(--shadow-lg)]",
        brand:
          "text-black font-bold bg-[linear-gradient(180deg,#F2712E_0%,#E8501A_100%)] shadow-[var(--edge-top),var(--shadow-ember)] hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] hover:brightness-[1.06]",
        live:
          "text-white font-bold bg-[linear-gradient(180deg,#FF6A2C_0%,#F2481A_100%)] shadow-[var(--edge-top),var(--shadow-ember)] hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] hover:brightness-[1.06]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-11 px-5",
        xl: "h-14 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
export { buttonVariants };
