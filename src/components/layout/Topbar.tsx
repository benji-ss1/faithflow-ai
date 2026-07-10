"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Bell,
  ChevronDown,
  Command,
  LogOut,
  Menu,
  Search,
  Settings,
  User,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getRouteMeta } from "@/components/layout/navigation";

type TopbarProps = {
  user: { name: string; email: string };
  churchName: string;
  onOpenNavigation: () => void;
};

type Hit = { id: string; title: string; subtitle?: string; href: string };
type SearchResults = { songs: Hit[]; bible: Hit[]; services: Hit[]; archive: Hit[] };
const EMPTY: SearchResults = { songs: [], bible: [], services: [], archive: [] };

const GROUP_LABELS: Array<{ key: keyof SearchResults; label: string }> = [
  { key: "songs", label: "Songs" },
  { key: "bible", label: "Bible" },
  { key: "services", label: "Services" },
  { key: "archive", label: "Archive" },
];

export function Topbar({ user, churchName, onOpenNavigation }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { title, subtitle } = getRouteMeta(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Search state
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const flatHits = useMemo(() => {
    const list: Hit[] = [];
    for (const g of GROUP_LABELS) list.push(...results[g.key]);
    return list;
  }, [results]);

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

  // Close account menu on outside click
  useEffect(() => {
    function onWindowClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    window.addEventListener("mousedown", onWindowClick);
    return () => window.removeEventListener("mousedown", onWindowClick);
  }, []);

  // Cmd/Ctrl+K focuses search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as SearchResults;
        setResults({
          songs: data.songs ?? [],
          bible: data.bible ?? [],
          services: data.services ?? [],
          archive: data.archive ?? [],
        });
        setActiveIndex(0);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const followHit = useCallback(
    (hit: Hit) => {
      setSearchOpen(false);
      setQuery("");
      router.push(hit.href);
    },
    [router]
  );

  const onSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(flatHits.length - 1, 0)));
        setSearchOpen(true);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const hit = flatHits[activeIndex];
        if (hit) {
          e.preventDefault();
          followHit(hit);
        }
      } else if (e.key === "Escape") {
        setSearchOpen(false);
      }
    },
    [flatHits, activeIndex, followHit]
  );

  const hasAny = flatHits.length > 0;
  const showDropdown = searchOpen && query.trim().length >= 2;

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

        {/* Global search */}
        <div ref={searchWrapRef} className="relative hidden md:block">
          <div className="group flex min-w-[280px] items-center gap-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.14)] transition focus-within:border-white/16 focus-within:bg-white/[0.06] xl:min-w-[360px]">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={onSearchKey}
              placeholder="Search songs, Bible, services, archive"
              aria-label="Global search"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/8 bg-black/20 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              <Command className="h-3 w-3" />K
            </div>
          </div>

          {showDropdown ? (
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[420px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(35,43,43,0.98),rgba(23,29,29,0.98))] shadow-[0_30px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl">
              <div className="max-h-[480px] overflow-y-auto p-2">
                {loading && !hasAny ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">Searching…</div>
                ) : !hasAny ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">No results for “{query}”.</div>
                ) : (
                  (() => {
                    let running = 0;
                    return GROUP_LABELS.map((g) => {
                      const items = results[g.key];
                      if (items.length === 0) return null;
                      return (
                        <div key={g.key} className="mb-2 last:mb-0">
                          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">
                            {g.label}
                          </div>
                          <div className="space-y-0.5">
                            {items.map((hit) => {
                              const idx = running++;
                              const active = idx === activeIndex;
                              return (
                                <button
                                  key={hit.href + hit.id}
                                  type="button"
                                  onMouseEnter={() => setActiveIndex(idx)}
                                  onClick={() => followHit(hit)}
                                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                                    active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-foreground">{hit.title}</div>
                                    {hit.subtitle ? (
                                      <div className="truncate text-[11px] text-muted-foreground">{hit.subtitle}</div>
                                    ) : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()
                )}
              </div>
              <div className="flex items-center justify-between border-t border-white/8 bg-black/20 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span>↑↓ navigate · ↵ open · esc close</span>
                <span>Cmd/Ctrl + K</span>
              </div>
            </div>
          ) : null}
        </div>

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
                  Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition hover:bg-white/[0.05]"
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Settings
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
