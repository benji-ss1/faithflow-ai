"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { accountNav, getActiveNavMatch, getRouteMeta, workspaceNav } from "@/components/layout/navigation";

type SidebarProps = {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

function ChildGroup({
  item,
  active,
  collapsed,
  pathname,
  onNavigate,
}: {
  item: { label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; children?: Array<{ label: string; href?: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }> };
  active: boolean;
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState<boolean>(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const Icon = item.icon;

  if (collapsed) {
    // In collapsed mode: show a single icon tile with tooltip listing the children on hover via title
    const first = item.children?.[0];
    if (!first?.href) return null;
    return (
      <Link
        href={first.href}
        title={`${item.label}: ${item.children?.map((c) => c.label).join(", ")}`}
        onClick={onNavigate}
        className={cn(
          "group relative flex h-10 items-center justify-center overflow-hidden rounded-2xl border px-0 text-sm font-medium transition-all duration-200",
          active
            ? "border-[rgba(111,224,194,0.28)] bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] text-foreground"
            : "border-transparent text-sidebar-fg hover:border-white/10 hover:bg-white/[0.045]"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-sidebar-fg")} strokeWidth={active ? 2 : 1.8} />
      </Link>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "group relative flex h-10 w-full items-center gap-3 overflow-hidden rounded-2xl border px-3 text-left text-sm font-medium transition-all duration-200",
          active
            ? "border-[rgba(111,224,194,0.28)] bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] text-foreground shadow-[0_18px_45px_rgba(0,0,0,0.22)]"
            : "border-transparent text-sidebar-fg hover:border-white/10 hover:bg-white/[0.045]"
        )}
      >
        {active ? <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[var(--color-primary)]" /> : null}
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-sidebar-fg")} strokeWidth={active ? 2 : 1.8} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open ? "rotate-0" : "-rotate-90")} />
      </button>
      {open ? (
        <div className="ml-4 space-y-1 border-l border-white/8 pl-3">
          {item.children?.map((child) => {
            if (!child.href) return null;
            const isActive = pathname === child.href || pathname.startsWith(child.href + "/");
            const CIcon = child.icon;
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-xl border px-3 text-[13px] font-medium transition-colors",
                  isActive
                    ? "border-[rgba(111,224,194,0.24)] bg-white/[0.05] text-foreground"
                    : "border-transparent text-sidebar-fg hover:border-white/8 hover:bg-white/[0.03]"
                )}
              >
                <CIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2 : 1.7} />
                <span className="min-w-0 flex-1 truncate">{child.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function NavSection({
  collapsed,
  pathname,
  groups,
  unlocked,
  onNavigate,
}: {
  collapsed: boolean;
  pathname: string;
  groups: typeof workspaceNav;
  unlocked: string[] | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          {!collapsed ? (
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/80">
              {group.label}
            </div>
          ) : null}
          {group.items.map((item) => {
            const hasChildren = !!item.children && item.children.length > 0;
            const childActive = hasChildren && item.children!.some((c) => !!c.href && (pathname === c.href || pathname.startsWith(c.href + "/")));
            const active = (!!item.href && (pathname === item.href || pathname.startsWith(item.href + "/"))) || childActive;
            const lockedByTour = !!unlocked && !!item.href && !unlocked.includes(item.href);
            const disabled = !hasChildren && (item.disabled || lockedByTour || !item.href);

            const content = (
              <>
                <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-sidebar-fg")} strokeWidth={active ? 2 : 1.8} />
                {!collapsed ? (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] uppercase",
                        item.badge === "Live"
                          ? "border-[rgba(123,199,255,0.28)] bg-[rgba(123,199,255,0.08)] text-[var(--color-accent)]"
                          : "border-white/10 bg-white/[0.04] text-muted-foreground"
                      )}>
                        {item.badge}
                      </span>
                    ) : null}
                    {disabled && !item.badge ? <LockKeyhole className="h-3.5 w-3.5 text-muted-foreground/70" /> : null}
                  </>
                ) : null}
              </>
            );

            const className = cn(
              "group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-3 text-sm font-medium transition-all duration-200",
              collapsed ? "h-10 justify-center px-0" : "h-10",
              active
                ? "border-[rgba(111,224,194,0.28)] bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] text-foreground shadow-[0_18px_45px_rgba(0,0,0,0.22)]"
                : "border-transparent text-sidebar-fg hover:border-white/10 hover:bg-white/[0.045]",
              disabled && "cursor-not-allowed opacity-70 hover:border-transparent hover:bg-transparent"
            );

            if (disabled) {
              return (
                <div key={item.label} title={item.badge ? `${item.label} — ${item.badge}` : `${item.label} — coming later`}
                  className={className} aria-disabled>
                  {active ? <span className={cn("absolute left-0 top-2 bottom-2 rounded-full bg-[var(--color-primary)]", collapsed ? "w-1 left-1.5" : "w-1")} /> : null}
                  {content}
                </div>
              );
            }

            if (hasChildren) {
              return (
                <ChildGroup
                  key={item.label}
                  item={item}
                  active={active}
                  collapsed={collapsed}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href!}
                title={collapsed ? item.label : undefined}
                className={className}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
              >
                {active ? <span className={cn("absolute left-0 top-2 bottom-2 rounded-full bg-[var(--color-primary)]", collapsed ? "w-1 left-1.5" : "w-1")} /> : null}
                {content}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function Sidebar({ mobileOpen, onMobileOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const route = getRouteMeta(pathname);
  const activeMatch = getActiveNavMatch(pathname);
  const ActiveIcon = activeMatch?.item.icon || Sparkles;
  const [collapsed, setCollapsed] = useState(false);
  const [unlocked, setUnlocked] = useState<string[] | null>(null);

  useEffect(() => {
    function read() {
      const raw = localStorage.getItem("ff_tutorial_unlocked");
      if (!raw) {
        setUnlocked(null);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        setUnlocked(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : null);
      } catch {
        setUnlocked(null);
      }
    }
    read();
    window.addEventListener("ff-tutorial-update", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("ff-tutorial-update", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("faithflow.sidebar.collapsed");
    if (stored === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("faithflow.sidebar.collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setCollapsed((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shell = (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-white/8 bg-[linear-gradient(180deg,rgba(35,43,43,0.96),rgba(21,26,26,0.98))] shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)] backdrop-blur-xl transition-[width,transform] duration-300 ease-out",
        collapsed ? "w-[92px]" : "w-[302px]"
      )}
    >
      <div className={cn("flex h-20 items-center border-b border-white/8", collapsed ? "justify-center px-3" : "px-5")}>
        <div className={cn("flex min-w-0 items-center gap-3", collapsed && "justify-center")}>
          <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] shadow-[0_12px_36px_rgba(0,0,0,0.28)]">
            <Sparkles className="h-4.5 w-4.5 text-[var(--color-primary)]" strokeWidth={1.9} />
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">PresentFlow</div>
              <div className="truncate text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Dashboard Console</div>
            </div>
          ) : null}
        </div>
        {!collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="ml-auto hidden h-9 w-9 items-center justify-center rounded-xl border border-white/8 text-muted-foreground transition hover:border-white/14 hover:bg-white/[0.05] hover:text-foreground lg:inline-flex"
            title="Collapse"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className={cn("flex-1 space-y-7 overflow-y-auto py-5", collapsed ? "px-3" : "px-4")}>
        <div
          className={cn(
            "overflow-hidden rounded-[1.35rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] shadow-[0_16px_40px_rgba(0,0,0,0.18)]",
            collapsed ? "px-0 py-3" : "p-4"
          )}
          title={collapsed ? `${route.title} — ${activeMatch?.group || "Workspace"}` : undefined}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                <ActiveIcon className="h-4.5 w-4.5 text-[var(--color-primary)]" />
              </div>
              <span className="inline-flex rounded-full border border-[rgba(111,224,194,0.25)] bg-[rgba(111,224,194,0.08)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">
                Active
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Active workspace</div>
                  <div className="mt-1 truncate text-sm font-semibold text-foreground">{route.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{route.subtitle}</div>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  <ActiveIcon className="h-4.5 w-4.5 text-[var(--color-primary)]" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-[rgba(111,224,194,0.25)] bg-[rgba(111,224,194,0.08)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-primary)]">
                  {activeMatch?.group || "Workspace"}
                </span>
                <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {activeMatch?.section || "workspace"}
                </span>
              </div>

              <Link
                href={activeMatch?.item.href || "/dashboard"}
                className="inline-flex items-center gap-2 text-xs font-medium text-foreground transition hover:text-[var(--color-primary)]"
                onClick={() => onMobileOpenChange(false)}
              >
                Open current section
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>

        <NavSection
          collapsed={collapsed}
          pathname={pathname}
          groups={workspaceNav}
          unlocked={unlocked}
          onNavigate={() => onMobileOpenChange(false)}
        />

        <div className="space-y-3 rounded-[1.35rem] border border-white/7 bg-white/[0.03] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          {!collapsed ? (
            <>
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Account</div>
                <div className="text-sm font-semibold text-foreground">Admin surfaces</div>
                <div className="text-xs leading-5 text-muted-foreground">
                  Billing, subscriptions, profile, and application management stay separate from Sunday-live controls.
                </div>
              </div>
              <NavSection
                collapsed={false}
                pathname={pathname}
                groups={accountNav}
                unlocked={null}
                onNavigate={() => onMobileOpenChange(false)}
              />
            </>
          ) : (
            <div className="flex justify-center">
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2.5">
                <CreditCardProxy />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={cn("border-t border-white/8 py-4", collapsed ? "px-3" : "px-4")}>
        <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between")}>
          {collapsed ? (
            <>
              <ThemeToggle compact />
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="hidden h-8 w-8 items-center justify-center rounded-xl border border-white/8 text-muted-foreground transition hover:border-white/14 hover:bg-white/[0.05] hover:text-foreground lg:inline-flex"
                title="Expand"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div>
                <div className="text-xs text-muted-foreground">Theme</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Cmd/Ctrl + / toggles sidebar</div>
              </div>
              <ThemeToggle compact />
            </>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden shrink-0 lg:block">{shell}</div>

      <div className={cn("fixed inset-0 z-50 lg:hidden", mobileOpen ? "pointer-events-auto" : "pointer-events-none")}>
        <div
          className={cn(
            "absolute inset-0 bg-[rgba(10,13,13,0.68)] backdrop-blur-sm transition-opacity duration-300",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => onMobileOpenChange(false)}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 max-w-[88vw] transition-transform duration-300 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="absolute right-4 top-4 z-10">
            <button
              type="button"
              onClick={() => onMobileOpenChange(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-foreground shadow-[0_14px_28px_rgba(0,0,0,0.24)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {shell}
        </div>
      </div>
    </>
  );
}

function CreditCardProxy() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6.5" width="18" height="11" rx="2.5" />
      <path d="M3 10.5h18" />
      <path d="M7 15h4" />
    </svg>
  );
}
