import { cn } from "@/lib/utils";

// Clean, ACMR-style card: white in light mode, deep charcoal in dark mode,
// 1px border, no shadows. Consumers use `tone` to signal muted / premium
// backgrounds, but the base treatment stays flat by default.
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
        "rounded-[10px] border p-6 transition-colors duration-150",
        tone === "premium"
          ? "border-[var(--pf-admin-accent)]/40 bg-[var(--pf-admin-accent-soft)]"
          : tone === "muted"
            ? "border-[var(--pf-admin-border-subtle)] bg-[var(--pf-admin-bg-subtle)]"
            : "border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)]",
        className,
      )}
    >
      {eyebrow ? (
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">
          {eyebrow}
        </div>
      ) : null}
      <div className="mb-3 text-base font-semibold tracking-[-0.01em] text-[var(--pf-admin-text)]">
        {title}
      </div>
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
      ? "bg-[rgba(61,154,80,0.10)] text-[var(--pf-admin-green)]"
      : tone === "warning"
        ? "bg-[rgba(239,159,39,0.12)] text-[var(--pf-admin-gold)]"
        : tone === "danger"
          ? "bg-[rgba(220,53,69,0.10)] text-[var(--pf-admin-red)]"
          : tone === "brand"
            ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-accent)]"
            : "bg-[var(--pf-admin-bg-muted)] text-[var(--pf-admin-text-secondary)]";

  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium", toneClass)}>
      {label}
    </span>
  );
}
