"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { IconTooltip } from "@/components/ui/tooltip";
import { desktopNav, workspaceNav } from "@/components/layout/navigation";
import { useShell } from "@/hooks/useShell";

type SidebarProps = {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  churchLogoUrl?: string | null;
  churchName?: string;
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
    const first = item.children?.[0];
    if (!first?.href) return null;
    return (
      <IconTooltip label={`${item.label}: ${item.children?.map((c) => c.label).join(", ")}`}>
        <Link
          href={first.href}
          onClick={onNavigate}
          className={cn(
            "group relative flex h-9 items-center justify-center rounded-md text-sm font-medium transition-colors duration-150",
            active
              ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-text)]"
              : "text-[var(--pf-admin-text-secondary)] hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)]"
          )}
        >
          <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[var(--pf-admin-accent)]" : "text-[var(--pf-admin-text-muted)]")} strokeWidth={active ? 2 : 1.7} />
        </Link>
      </IconTooltip>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "group relative flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-[13px] font-medium transition-colors duration-150",
          active
            ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-text)]"
            : "text-[var(--pf-admin-text-secondary)] hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)]"
        )}
      >
        {active ? <span className="absolute left-0 top-1.5 bottom-1.5 -ml-3 w-[3px] rounded-r-full bg-[var(--pf-admin-accent)]" /> : null}
        <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[var(--pf-admin-accent)]" : "text-[var(--pf-admin-text-muted)]")} strokeWidth={active ? 2 : 1.7} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-[var(--pf-admin-text-muted)] transition-transform duration-200", open ? "rotate-0" : "-rotate-90")} />
      </button>
      {open ? (
        <div className="ml-4 space-y-0.5 border-l border-[var(--pf-admin-border-subtle)] pl-3">
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
                  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
                  isActive
                    ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-text)]"
                    : "text-[var(--pf-admin-text-secondary)] hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)]"
                )}
              >
                <CIcon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-[var(--pf-admin-accent)]" : "text-[var(--pf-admin-text-muted)]")} strokeWidth={isActive ? 2 : 1.7} />
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
        <div key={group.label} className="space-y-0.5">
          {!collapsed ? (
            <div className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">
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
                <item.icon
                  className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[var(--pf-admin-accent)]" : "text-[var(--pf-admin-text-muted)]")}
                  strokeWidth={active ? 2 : 1.7}
                />
                {!collapsed ? (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--pf-admin-text-muted)]">
                        {item.badge}
                      </span>
                    ) : null}
                    {disabled && !item.badge ? <LockKeyhole className="h-3.5 w-3.5 text-[var(--pf-admin-text-muted)]" /> : null}
                  </>
                ) : null}
              </>
            );

            const className = cn(
              "group relative flex items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150",
              collapsed ? "h-9 justify-center px-0" : "h-9",
              active
                ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-text)]"
                : "text-[var(--pf-admin-text-secondary)] hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)]",
              disabled && "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-[var(--pf-admin-text-secondary)]"
            );

            if (disabled) {
              const disabledLabel = item.badge ? `${item.label} — ${item.badge}` : `${item.label} — coming later`;
              const disabledEl = (
                <div key={item.label} title={collapsed ? undefined : disabledLabel}
                  className={className} aria-disabled>
                  {active ? <span className={cn("absolute left-0 top-1.5 bottom-1.5 rounded-r-full bg-[var(--pf-admin-accent)]", collapsed ? "w-[3px] left-0" : "w-[3px] -ml-3")} /> : null}
                  {content}
                </div>
              );
              return collapsed ? <IconTooltip key={item.label} label={disabledLabel}>{disabledEl}</IconTooltip> : disabledEl;
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

            const link = (
              <Link
                key={item.href}
                href={item.href!}
                className={className}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
              >
                {active ? <span className={cn("absolute left-0 top-1.5 bottom-1.5 rounded-r-full bg-[var(--pf-admin-accent)]", collapsed ? "w-[3px] left-0" : "w-[3px] -ml-3")} /> : null}
                {content}
              </Link>
            );
            return collapsed ? <IconTooltip key={item.href} label={item.label}>{link}</IconTooltip> : link;
          })}
        </div>
      ))}
    </>
  );
}

export function Sidebar({ mobileOpen, onMobileOpenChange, churchLogoUrl, churchName }: SidebarProps) {
  const pathname = usePathname();
  const currentShell = useShell();
  const isDesktop = currentShell === "desktop";
  const navGroups = isDesktop ? desktopNav : workspaceNav;
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
    const stored = localStorage.getItem("presentflow.sidebar.collapsed");
    if (stored === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("presentflow.sidebar.collapsed", collapsed ? "1" : "0");
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
        "relative flex h-full flex-col border-r transition-[width,transform] duration-300 ease-out",
        // Backing surface + border use the admin tokens (defined by ancestor
        // AppShell's .pf-admin-scope) so light mode renders clean off-white
        // while dark mode stays deep charcoal. Operator surfaces (which never
        // wrap in pf-admin-scope) are untouched.
        "border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-subtle)]",
        collapsed ? "w-[80px]" : "w-[240px]"
      )}
    >
      {/* Always-visible, clearly discoverable collapse/expand control. */}
      <IconTooltip label={collapsed ? "Expand sidebar (Cmd/Ctrl + /)" : "Collapse sidebar (Cmd/Ctrl + /)"} side="right">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3.5 top-8 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-[var(--pf-admin-border-strong)] bg-[var(--pf-admin-bg-card)] text-[var(--pf-admin-text-muted)] shadow-sm transition hover:border-[var(--pf-admin-accent)]/40 hover:text-[var(--pf-admin-text)] lg:inline-flex"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </IconTooltip>

      {/* Branded header — dark gradient block. This is the ONE spot where the
          sidebar deliberately breaks the clean neutral aesthetic, so the
          PresentFlow brand mark reads instantly. Gradient stripe at the
          bottom separates it from the neutral nav below. */}
      <div
        className={cn("relative flex flex-col overflow-hidden", collapsed ? "px-3" : "px-4")}
        style={{ background: "var(--pf-gradient-dark-bg)" }}
      >
        {/* Subtle brand glow — echoes the landing page */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(circle at 15% 20%, rgba(155,143,232,0.18), transparent 55%), radial-gradient(circle at 85% 90%, rgba(232,116,42,0.22), transparent 55%)",
          }}
        />
        <div className={cn("relative flex min-h-[80px] min-w-0 items-center gap-3 pt-4", collapsed && "justify-center")}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur">
            <Sparkles className="h-4 w-4 text-[#E8742A]" strokeWidth={2} />
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold leading-tight">
                <span className="text-[#F1EFE8]">Present</span>
                <span className="text-[#E8742A]">Flow</span>
              </div>
              <div className="truncate text-[10px] uppercase tracking-[0.22em] text-[#A8A6A0]">Dashboard</div>
            </div>
          ) : null}
        </div>
        {!collapsed && (churchLogoUrl || churchName) ? (
          <div className="relative mb-4 mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5 backdrop-blur">
            {churchLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={churchLogoUrl}
                alt=""
                width={22}
                height={22}
                referrerPolicy="no-referrer"
                className="h-[22px] w-[22px] shrink-0 rounded object-contain"
              />
            ) : (
              <div className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded bg-white/15 text-[10px] font-semibold text-white/90">
                {(churchName || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="truncate text-[11px] font-medium text-white/85">{churchName || "Church workspace"}</span>
          </div>
        ) : collapsed && (churchLogoUrl || churchName) ? (
          // Collapsed mode: show just the logo (or monogram) so church
          // identity doesn't disappear entirely when the sidebar shrinks.
          <IconTooltip label={churchName || "Church workspace"} side="right">
            <div className="relative mx-auto mb-4 mt-3 grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.06] backdrop-blur">
              {churchLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={churchLogoUrl}
                  alt=""
                  width={22}
                  height={22}
                  referrerPolicy="no-referrer"
                  className="h-[22px] w-[22px] rounded object-contain"
                />
              ) : (
                <span className="text-[11px] font-semibold text-white/90">
                  {(churchName || "?").charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          </IconTooltip>
        ) : (
          <div className="pb-4" />
        )}
        {/* Signature 2px brand gradient stripe */}
        <div
          aria-hidden
          className="absolute bottom-0 left-0 right-0 h-[2px]"
          style={{ background: "var(--pf-gradient-brand)" }}
        />
      </div>

      <div className={cn("flex-1 space-y-6 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
        <NavSection
          collapsed={collapsed}
          pathname={pathname}
          groups={navGroups}
          unlocked={isDesktop ? null : unlocked}
          onNavigate={() => onMobileOpenChange(false)}
        />
      </div>

      <div className={cn("border-t border-[var(--pf-admin-border)] py-3", collapsed ? "px-2" : "px-3")}>
        <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between")}>
          {collapsed ? (
            <ThemeToggle compact />
          ) : (
            <>
              <div>
                <div className="text-xs text-[var(--pf-admin-text-secondary)]">Theme</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--pf-admin-text-muted)]">⌘/ toggles sidebar</div>
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

// DesktopFooterPanel removed 2026-07-25: Sidebar never mounts in the desktop
// (Electron) shell — see AppShell.tsx, which short-circuits with a bare
// wrapper when isDesktop. Reviewer flagged as dead code. The Manage/Settings/
// Sign-out affordances the panel provided are already reachable via the web
// admin's topbar user dropdown + the sidebar's ADMIN group (Settings row).

