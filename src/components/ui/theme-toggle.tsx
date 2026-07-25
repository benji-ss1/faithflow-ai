"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Client-side theme toggle. Writes `ff_theme` cookie + toggles the
 * `html.light` class immediately for a flicker-free swap. Server RSC layout
 * reads the same cookie so hard reloads land in the right theme.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !isLight;
    setIsLight(next);
    document.documentElement.classList.toggle("light", next);
    document.cookie = `ff_theme=${next ? "light" : "dark"}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }

  if (compact) {
    return (
      <button
        onClick={toggle}
        title={isLight ? "Switch to dark" : "Switch to light"}
        aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--pf-admin-text-secondary)] transition hover:bg-[var(--pf-admin-bg-hover)] hover:text-[var(--pf-admin-text)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
      >
        {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>
    );
  }
  return (
    <button onClick={toggle}
      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent w-full text-left">
      {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
      Switch to {isLight ? "dark" : "light"} theme
    </button>
  );
}
