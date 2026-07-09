"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Bell,
  ChevronDown,
  Command,
  LogOut,
  Menu,
  Search,
  User,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getRouteMeta } from "@/components/layout/navigation";

type TopbarProps = {
  user: { name: string; email: string };
  churchName: string;
  onOpenNavigation: () => void;
};

export function Topbar({ user, churchName, onOpenNavigation }: TopbarProps) {
  const pathname = usePathname();
  const { title, subtitle } = getRouteMeta(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const initials = useMemo(
    () =>
      user.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || user.email[0]?.toUpperCase() || "U",
    [user.email, user.name]
  );

  useState(() => {
    function onWindowClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onWindowClick);
    return () => window.removeEventListener("mousedown", onWindowClick);
  });

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-[linear-gradient(180deg,rgba(21,25,25,0.92),rgba(21,25,25,0.8))] backdrop-blur-xl">
      <div className="flex h-[88px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenNavigation}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-foreground shadow-[0_14px_28px_rgba(0,0,0,0.18)] lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">FaithFlow Workspace</div>
          <div className="truncate text-xl font-semibold tracking-[-0.03em] text-foreground">{title}</div>
          <div className="hidden truncate text-sm text-muted-foreground xl:block">{subtitle}</div>
        </div>

        <button
          type="button"
          className="group hidden min-w-[280px] items-center justify-between rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-3 text-left shadow-[0_18px_40px_rgba(0,0,0,0.14)] transition hover:border-white/16 hover:bg-white/[0.06] md:flex xl:min-w-[360px]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.05] text-muted-foreground">
              <Search className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">Search commands, services, songs</div>
              <div className="text-xs text-muted-foreground">Command palette placeholder for a later phase.</div>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <Command className="h-3.5 w-3.5" />
            K
          </div>
        </button>

        <div className="hidden items-center gap-2 xl:flex">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-right shadow-[0_12px_28px_rgba(0,0,0,0.14)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Church</div>
            <div className="max-w-[190px] truncate text-sm font-medium text-foreground">{churchName}</div>
          </div>
        </div>

        <button
          type="button"
          className="hidden h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-muted-foreground transition hover:border-white/16 hover:bg-white/[0.06] hover:text-foreground md:inline-flex"
          aria-label="Notifications"
        >
          <Bell className="h-4.5 w-4.5" />
        </button>

        <div className="hidden md:block">
          <ThemeToggle compact />
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-2.5 pr-3 shadow-[0_16px_36px_rgba(0,0,0,0.16)] transition hover:border-white/16 hover:bg-white/[0.06]"
          >
            <div className="flex h-8.5 w-8.5 items-center justify-center rounded-full bg-[linear-gradient(180deg,var(--color-primary),color-mix(in_oklab,var(--color-primary)_70%,white))] text-[11px] font-bold text-[var(--color-background)]">
              {initials}
            </div>
            <div className="hidden min-w-0 text-left lg:block">
              <div className="max-w-[140px] truncate text-sm font-medium text-foreground">{user.name}</div>
              <div className="max-w-[140px] truncate text-[11px] text-muted-foreground">{user.email}</div>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-72 overflow-hidden rounded-[1.4rem] border border-white/10 bg-[linear-gradient(180deg,rgba(35,43,43,0.98),rgba(23,29,29,0.98))] p-2 shadow-[0_30px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl">
              <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.04] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Signed in as</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{user.name}</div>
                <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                <div className="mt-3 rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{churchName}</span>
                  <span className="ml-1">workspace active</span>
                </div>
              </div>

              <div className="mt-2 space-y-1">
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition hover:bg-white/[0.05]"
                >
                  <User className="h-4 w-4 text-muted-foreground" />
                  My profile
                </Link>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition hover:bg-white/[0.05]"
                >
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
