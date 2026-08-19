"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { ANNOUNCEMENT } from "@/lib/announcement";

const DISMISS_PREFIX = "presentflow.announcement.dismissed.";

/**
 * Slim, dismissible announcement bar across the top of the operator — for
 * updates and big news. Driven by `ANNOUNCEMENT` in @/lib/announcement.
 * Dismissal is remembered per-id (change the id to re-surface a new message).
 * Renders nothing when there is no active announcement or it was dismissed.
 */
export function AnnouncementBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!ANNOUNCEMENT) return;
    try {
      const dismissed = window.localStorage.getItem(DISMISS_PREFIX + ANNOUNCEMENT.id);
      setShow(dismissed !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  if (!ANNOUNCEMENT || !show) return null;
  const ann = ANNOUNCEMENT;

  const info = ann.tone === "info";
  const bg = info ? "#4f8ff0" : "var(--color-brand)";
  const fg = "#17130c";

  const dismiss = () => {
    setShow(false);
    try { window.localStorage.setItem(DISMISS_PREFIX + ann.id, "1"); } catch { /* noop */ }
  };

  return (
    <div
      className="relative shrink-0 h-9 flex items-center justify-center gap-3 px-10 text-[12.5px] font-medium"
      style={{ background: bg, color: fg }}
      role="status"
    >
      <span className="truncate">{ann.message}</span>
      {ann.ctaLabel && ann.ctaHref && (
        <Link
          href={ann.ctaHref}
          className="shrink-0 inline-flex items-center gap-1 h-6 px-2.5 rounded-md text-[11.5px] font-bold"
          style={{ background: "#ffffff", color: "#17130c" }}
        >
          {ann.ctaLabel} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-2 grid h-6 w-6 place-items-center rounded hover:bg-black/10"
        style={{ color: fg }}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
