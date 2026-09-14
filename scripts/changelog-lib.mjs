// Pure helpers for scripts/build-changelog.mjs (importable from tests).
// No dependencies — a tiny frontmatter parser covers the changes/*.md format.

export const AUDIENCES = ["operator", "admin"];

export function cmpVersion(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function bumpPatch(v) {
  const p = String(v).split(".").map((n) => parseInt(n, 10) || 0);
  while (p.length < 3) p.push(0);
  p[p.length - 1] += 1;
  return p.join(".");
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}

/**
 * Parse one changes/<slug>.md file. Frontmatter (between --- lines):
 *   headline: text            (required)
 *   audience: operator|admin  (optional, default operator)
 *   version: 0.1.404          (optional — pins the release this belongs to)
 *   date: YYYY-MM-DD          (optional)
 *   order: 1                  (optional — sort within a release; lowest first)
 *   highlights:               (optional list; defaults to [headline])
 *     - text
 * Throws with the slug in the message on any invalid file.
 */
export function parseChangeFile(text, slug) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error(`changes/${slug}.md: missing --- frontmatter ---`);
  const out = { slug, headline: "", highlights: [], audience: "operator", version: undefined, date: undefined, order: undefined };
  let inList = false;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw) || (inList ? /^-\s+(.*)$/.exec(raw) : null);
    if (item) {
      if (!inList) throw new Error(`changes/${slug}.md: list item outside "highlights:"`);
      const v = unquote(item[1]);
      if (v) out.highlights.push(v);
      continue;
    }
    const kv = /^([a-zA-Z]+):\s*(.*)$/.exec(raw);
    if (!kv) throw new Error(`changes/${slug}.md: cannot parse line "${raw}"`);
    const [, key, value] = kv;
    inList = false;
    switch (key) {
      case "headline": out.headline = unquote(value); break;
      case "audience": out.audience = unquote(value); break;
      case "version": out.version = unquote(value) || undefined; break;
      case "date": out.date = unquote(value) || undefined; break;
      case "order": out.order = value.trim() === "" ? undefined : Number(value); break;
      case "highlights": inList = true; if (value.trim()) throw new Error(`changes/${slug}.md: highlights must be a "- item" list`); break;
      default: throw new Error(`changes/${slug}.md: unknown key "${key}"`);
    }
  }
  if (!out.headline) throw new Error(`changes/${slug}.md: headline is required`);
  if (!AUDIENCES.includes(out.audience)) throw new Error(`changes/${slug}.md: audience must be one of ${AUDIENCES.join("|")}`);
  if (out.version && !/^\d+\.\d+\.\d+$/.test(out.version)) throw new Error(`changes/${slug}.md: version must look like 0.1.404`);
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error(`changes/${slug}.md: date must be YYYY-MM-DD`);
  if (out.order !== undefined && !Number.isFinite(out.order)) throw new Error(`changes/${slug}.md: order must be a number`);
  if (out.highlights.length === 0) out.highlights = [out.headline];
  return out;
}

/** Extract { version, headline } pairs from the curated src/lib/changelog.ts source. */
export function readHistory(source) {
  const out = [];
  const re = /version:\s*"([^"]+)",\s*\n\s*date:\s*"[^"]*",\s*\n\s*headline:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(source))) out.push({ version: m[1], headline: JSON.parse(`"${m[2]}"`) });
  return out;
}

/**
 * Group parsed changes into ChangelogEntry objects (newest-first).
 * - Changes whose headline already appears in history are skipped (already merged by hand).
 * - Unpinned changes go to the "next" release: package.json version if it is
 *   newer than everything known, else one patch past the newest known version.
 * - A pinned version that already exists in history (headline not merged) is an error.
 */
export function buildEntries(changes, { pkgVersion, history, today }) {
  const historyVersions = new Set(history.map((h) => h.version));
  const historyHeadlines = new Set(history.map((h) => h.headline));
  const pending = changes.filter((c) => !historyHeadlines.has(c.headline));
  for (const c of pending) {
    if (c.version && historyVersions.has(c.version)) {
      throw new Error(`changes/${c.slug}.md: version ${c.version} already exists in src/lib/changelog.ts history — remove "version:" or merge it there`);
    }
  }
  let newest = "0.0.0";
  for (const v of [...historyVersions, ...pending.map((c) => c.version).filter(Boolean)]) if (cmpVersion(v, newest) > 0) newest = v;
  const next = cmpVersion(pkgVersion, newest) > 0 ? pkgVersion : bumpPatch(newest);

  const groups = new Map();
  for (const c of pending) {
    const v = c.version || next;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(c);
  }
  const entries = [];
  for (const [version, list] of groups) {
    list.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const dates = list.map((c) => c.date).filter(Boolean).sort();
    entries.push({
      version,
      date: dates.length ? dates[dates.length - 1] : today,
      headline: list[0].headline,
      highlights: list.flatMap((c) => c.highlights),
    });
  }
  entries.sort((a, b) => cmpVersion(b.version, a.version));
  return entries;
}

export function renderModule(entries) {
  return `// AUTO-GENERATED by scripts/build-changelog.mjs from changes/*.md — DO NOT EDIT.
// Add a changes/<slug>.md file instead (see changes/README.md).
import type { ChangelogEntry } from "./changelog-types";

export const GENERATED_CHANGELOG: ChangelogEntry[] = ${JSON.stringify(entries, null, 2)};
`;
}
