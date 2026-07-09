import { cn } from "@/lib/utils";

export function DashboardCard({
  title,
  eyebrow,
  children,
  className,
  tone = "default",
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "premium" | "muted";
}) {
  return (
    <section
      className={cn(
        "rounded-[1.4rem] p-5 transition-all duration-200",
        tone === "premium"
          ? "ff-card-premium"
          : tone === "muted"
            ? "border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] shadow-[0_16px_38px_rgba(0,0,0,0.14)]"
            : "border border-white/8 bg-[linear-gradient(180deg,rgba(35,43,43,0.92),rgba(27,33,33,0.95))] shadow-[0_18px_45px_rgba(0,0,0,0.16)]",
        className
      )}
    >
      {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
      <div className="mb-3 text-base font-semibold tracking-[-0.02em] text-foreground">{title}</div>
      {children}
    </section>
  );
}

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "brand";
}) {
  const toneClass =
    tone === "success"
      ? "border-[rgba(79,209,139,0.25)] bg-[rgba(79,209,139,0.12)] text-[var(--color-success)]"
      : tone === "warning"
        ? "border-[rgba(240,179,90,0.25)] bg-[rgba(240,179,90,0.12)] text-[var(--color-warning)]"
        : tone === "danger"
          ? "border-[rgba(242,109,109,0.25)] bg-[rgba(242,109,109,0.12)] text-[var(--color-destructive)]"
          : tone === "brand"
            ? "border-[rgba(111,224,194,0.24)] bg-[rgba(111,224,194,0.12)] text-[var(--color-primary)]"
            : "border-white/10 bg-white/[0.04] text-muted-foreground";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium", toneClass)}>
      {label}
    </span>
  );
}
