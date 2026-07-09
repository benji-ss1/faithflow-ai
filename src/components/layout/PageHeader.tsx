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
    <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        {eyebrow && <div className="eyebrow text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-3xl font-semibold font-display tracking-[-0.04em] text-foreground md:text-4xl">{title}</h1>
        {description && <p className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-[15px]">{description}</p>}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
