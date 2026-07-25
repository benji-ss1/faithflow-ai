export function PageHeader({
  title,
  eyebrow,
  description,
  action,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1.5">
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--pf-admin-text)] md:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-sm leading-6 text-[var(--pf-admin-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
