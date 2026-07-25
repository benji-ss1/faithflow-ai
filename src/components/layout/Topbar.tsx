"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { signOutFully } from "@/lib/sign-out";
import {
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
import { ChurchLogoAvatar } from "@/components/brand/ChurchLogoAvatar";

type TopbarProps = {
  user: { name: string; email: string };
  churchName: string;
  churchLogoUrl?: string | null;
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

export function Topbar({ user, churchName, churchLogoUrl, onOpenNavigation }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { title } = getRouteMeta(pathname);
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
    <header className="sticky top-0 z-40 border-b border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-page)]">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenNavigation}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-subtle)] text-[var(--pf-admin-text-secondary)] transition hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)] lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">PresentFlow Workspace</div>
          <div className="truncate text-base font-semibold tracking-[-0.01em] text-[var(--pf-admin-text)]">{title}</div>
        </div>

        {/* Global search — min-width steps up by breakpoint so the page
            title stays legible at narrower widths. */}
        <div ref={searchWrapRef} className="relative hidden md:block">
          <div className="group flex min-w-[180px] items-center gap-2.5 rounded-md border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-muted)] px-3 py-2 transition focus-within:border-[var(--pf-admin-accent)] focus-within:bg-[var(--pf-admin-bg-card)] focus-within:shadow-[0_0_0_3px_var(--pf-admin-accent-ring)] lg:min-w-[240px] xl:min-w-[320px]">
            <Search className="h-4 w-4 shrink-0 text-[var(--pf-admin-text-muted)]" />
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
              placeholder="Search songs, Bible, services…"
              aria-label="Global search"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--pf-admin-text)] placeholder:text-[var(--pf-admin-text-muted)] focus:outline-none"
            />
            <div className="flex shrink-0 items-center gap-1 rounded border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--pf-admin-text-muted)]">
              <Command className="h-3 w-3" />K
            </div>
          </div>

          {showDropdown ? (
            <div className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[420px] overflow-hidden rounded-lg border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)] shadow-[0_12px_32px_rgba(15,15,15,0.12)]">
              <div className="max-h-[480px] overflow-y-auto p-2">
                {loading && !hasAny ? (
                  <div className="px-3 py-6 text-center text-xs text-[var(--pf-admin-text-secondary)]">Searching…</div>
                ) : !hasAny ? (
                  <div className="px-3 py-6 text-center text-xs text-[var(--pf-admin-text-secondary)]">No results for &ldquo;{query}&rdquo;.</div>
                ) : (
                  (() => {
                    let running = 0;
                    return GROUP_LABELS.map((g) => {
                      const items = results[g.key];
                      if (items.length === 0) return null;
                      return (
                        <div key={g.key} className="mb-2 last:mb-0">
                          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">
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
                                  className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                                    active
                                      ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-text)]"
                                      : "text-[var(--pf-admin-text-secondary)] hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)]"
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-[var(--pf-admin-text)]">{hit.title}</div>
                                    {hit.subtitle ? (
                                      <div className="truncate text-[11px] text-[var(--pf-admin-text-muted)]">{hit.subtitle}</div>
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
              <div className="flex items-center justify-between border-t border-[var(--pf-admin-border-subtle)] bg-[var(--pf-admin-bg-subtle)] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-[var(--pf-admin-text-muted)]">
                <span>↑↓ navigate · ↵ open · esc close</span>
                <span>⌘/Ctrl + K</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="hidden items-center gap-2 xl:flex">
          <div className="flex items-center gap-2.5 rounded-md border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-subtle)] pl-1.5 pr-3 py-1">
            <ChurchLogoAvatar
              logoUrl={churchLogoUrl}
              churchName={churchName}
              size={28}
              variant="light"
              className="rounded"
            />
            <div className="min-w-0">
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">Church</div>
              <div className="max-w-[160px] truncate text-xs font-medium text-[var(--pf-admin-text)]">{churchName}</div>
            </div>
          </div>
        </div>

        <div className="hidden md:block">
          <ThemeToggle compact />
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-10 items-center gap-2.5 rounded-md border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-subtle)] px-2 pr-3 transition hover:bg-[var(--pf-admin-bg-hover)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--pf-admin-accent)] text-[10px] font-bold text-[var(--pf-admin-text-inverse)]">
              {initials}
            </div>
            <div className="hidden min-w-0 text-left xl:block">
              <div className="max-w-[140px] truncate text-xs font-medium text-[var(--pf-admin-text)]">{user.name}</div>
              <div className="max-w-[140px] truncate text-[10px] text-[var(--pf-admin-text-muted)]">{user.email}</div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--pf-admin-text-muted)]" />
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-72 overflow-hidden rounded-lg border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)] shadow-[0_12px_32px_rgba(15,15,15,0.12)]">
              <div className="border-b border-[var(--pf-admin-border-subtle)] bg-[var(--pf-admin-bg-subtle)] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">Signed in as</div>
                <div className="mt-0.5 text-sm font-semibold text-[var(--pf-admin-text)]">{user.name}</div>
                <div className="truncate text-xs text-[var(--pf-admin-text-secondary)]">{user.email}</div>
                <div className="mt-2.5 rounded border border-[var(--pf-admin-border)] bg-[var(--pf-admin-bg-card)] px-2.5 py-1.5 text-[11px] text-[var(--pf-admin-text-secondary)]">
                  <span className="font-medium text-[var(--pf-admin-text)]">{churchName}</span>
                  <span className="ml-1 text-[var(--pf-admin-text-muted)]">workspace active</span>
                </div>
              </div>

              <div className="p-1.5">
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--pf-admin-text-secondary)] transition hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
                >
                  <User className="h-4 w-4 text-[var(--pf-admin-text-muted)]" />
                  Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--pf-admin-text-secondary)] transition hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
                >
                  <Settings className="h-4 w-4 text-[var(--pf-admin-text-muted)]" />
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={() => { void signOutFully("/login"); }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-[var(--pf-admin-text-secondary)] transition hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
                >
                  <LogOut className="h-4 w-4 text-[var(--pf-admin-text-muted)]" />
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
