"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { accountNav, workspaceNav } from "@/components/layout/navigation";

type SidebarProps = {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

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
            const active = !!item.href && (pathname === item.href || pathname.startsWith(item.href + "/"));
            const lockedByTour = !!unlocked && !!item.href && !unlocked.includes(item.href);
            const disabled = item.disabled || lockedByTour || !item.href;

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
              "group flex items-center gap-3 rounded-2xl border px-3 text-sm font-medium transition-all duration-200",
              collapsed ? "h-11 justify-center px-0" : "h-11",
              active
                ? "border-[rgba(111,224,194,0.28)] bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] text-foreground shadow-[0_18px_45px_rgba(0,0,0,0.22)]"
                : "border-transparent text-sidebar-fg hover:border-white/10 hover:bg-white/[0.045]",
              disabled && "cursor-not-allowed opacity-70 hover:border-transparent hover:bg-transparent"
            );

            if (disabled) {
              return (
                <div key={item.label} title={item.badge ? `${item.label} — ${item.badge}` : `${item.label} — coming later`}
                  className={className} aria-disabled>
                  {content}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href!}
                title={collapsed ? item.label : undefined}
                className={className}
                onClick={onNavigate}
              >
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
  const [collapsed, setCollapsed] = useState(false);
  const [unlocked, setUnlocked] = useState<string[] | null>(null);

  useEffect(() => {
    function read() {
      const raw = localStorage.getItem("ff_tutorial_unlocked");
      setUnlocked(raw ? (JSON.parse(raw) as string[]) : null);
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
    const stored = localStorage.getItem("ff_sidebar_collapsed");
    if (stored === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("ff_sidebar_collapsed", collapsed ? "1" : "0");
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
              <div className="truncate text-sm font-semibold text-foreground">FaithFlow AI</div>
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
              <div className="text-xs text-muted-foreground">Theme</div>
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
