// Pure helpers for scripts/build-changelog.mjs, scripts/new-change.mjs and
// scripts/check-changes.mjs (importable from tests). No dependencies.

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

export function maxVersion(versions) {
  let newest = "0.0.0";
  for (const v of versions) if (v && cmpVersion(v, newest) > 0) newest = v;
  return newest;
}

/** Strict X.Y.Z: no leading zeros (except "0"), every part a safe integer. */
export function isValidVersion(v) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(v));
  return !!m && m.slice(1).every((p) => Number(p) <= Number.MAX_SAFE_INTEGER);
}

/**
 * Split a changes/ directory listing into note files (exact lowercase `.md`,
 * README excluded) and badly-cased extensions (`.MD`, `.Md`, …) which build and
 * check both reject — so a note can never be silently ignored.
 */
export function classifyChangeFiles(names) {
  const files = [];
  const badExt = [];
  for (const f of names) {
    if (!/\.md$/i.test(f) || f.toLowerCase() === "readme.md") continue;
    (f.endsWith(".md") ? files : badExt).push(f);
  }
  return { files: files.sort(), badExt: badExt.sort() };
}

export const badExtMessage = (f) => `changes/${f}: the extension must be lowercase ".md" — rename it`;

/** Best-effort sniff of a top-level frontmatter scalar (version/date) from raw text. */
export function sniffField(text, key) {
  const m = new RegExp(`^${key}:\\s*["']?([^"'\\s]+)["']?\\s*$`, "m").exec(String(text).replace(/\r/g, ""));
  return m ? m[1] : undefined;
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}

export function isCalendarDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Parse one changes/<slug>.md file. Frontmatter (between --- lines):
 *   headline: text            (required)
 *   version: 0.1.404          (required — the release it belongs to; never edit once released)
 *   date: YYYY-MM-DD          (required, must be a real calendar date)
 *   audience: operator|admin  (optional, default operator)
 *   order: 1                  (optional — sort within a release; lowest first)
 *   highlights:               (optional list; defaults to [headline])
 *     - text
 * Throws with the slug in the message on any invalid file.
 */
/**
 * A highlight may end with a "try it" marker that turns into a button in the
 * What's New modal, so an operator can be TAKEN to the feature instead of
 * hunting for it:
 *
 *   - Some text. {try: /operator | smart-folder | Show me}
 *                       href      spotlight     label (optional)
 *
 * `spotlight` is the value of a `data-vic="..."` attribute on the real
 * control. On arrival, FeatureSpotlight rings that element — the same ring
 * Vic's guide uses — so the operator sees exactly which button is meant.
 * Omit the spotlight (`{try: /services || Open}`) to just navigate.
 */
function parseHighlight(value, slug) {
  const m = /^(.*?)\s*\{try:\s*([^|}]*?)\s*(?:\|\s*([^|}]*?)\s*)?(?:\|\s*([^|}]*?)\s*)?\}$/.exec(value);
  if (!m) return value;
  const [, text, href, spotlight, label] = m;
  if (!text) throw new Error(`changes/${slug}.md: a {try: ...} marker needs text before it`);
  if (!href) throw new Error(`changes/${slug}.md: {try: ...} needs a link, e.g. {try: /operator | smart-folder | Show me}`);
  if (!href.startsWith("/")) throw new Error(`changes/${slug}.md: {try: ...} link must start with "/" (got "${href}")`);
  const out = { text };
  out.tryItHref = href;
  if (spotlight) out.highlightParam = spotlight;
  if (label) out.tryItLabel = label;
  return out;
}

export function parseChangeFile(text, slug) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error(`changes/${slug}.md: missing --- frontmatter ---`);
  if (/[\u2028\u2029]/.test(m[1])) throw new Error(`changes/${slug}.md: contains a Unicode line/paragraph separator (U+2028/U+2029) — replace it with a normal space or new line`);
  const out = { slug, headline: "", highlights: [], audience: "operator", version: undefined, date: undefined, order: undefined };
  const seen = new Set();
  let inList = false;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw) || (inList ? /^-\s+(.*)$/.exec(raw) : null);
    if (item) {
      if (!inList) throw new Error(`changes/${slug}.md: list item outside "highlights:"`);
      const v = unquote(item[1]);
      if (v) out.highlights.push(parseHighlight(v, slug));
      continue;
    }
    const kv = /^([a-zA-Z]+):\s*(.*)$/.exec(raw);
    if (!kv) throw new Error(`changes/${slug}.md: cannot parse line "${raw}"`);
    const [, key, value] = kv;
    if (seen.has(key)) throw new Error(`changes/${slug}.md: duplicate key "${key}"`);
    seen.add(key);
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
  if (!out.version) throw new Error(`changes/${slug}.md: version is required — create notes with \`npm run changes:new -- <slug>\``);
  if (!isValidVersion(out.version)) throw new Error(`changes/${slug}.md: version must look like 0.1.404 (three whole numbers, no leading zeros; got "${out.version}")`);
  if (!out.date) throw new Error(`changes/${slug}.md: date is required (YYYY-MM-DD)`);
  if (!isCalendarDate(out.date)) throw new Error(`changes/${slug}.md: date must be a real YYYY-MM-DD date (got "${out.date}")`);
  if (!AUDIENCES.includes(out.audience)) throw new Error(`changes/${slug}.md: audience must be one of ${AUDIENCES.join("|")}`);
  if (out.order !== undefined && !Number.isFinite(out.order)) throw new Error(`changes/${slug}.md: order must be a number`);
  if (out.highlights.length === 0) out.highlights = [out.headline];
  return out;
}

/** Best-effort version sniff for files that may not fully parse (e.g. older formats). */
export function sniffVersion(text) {
  const m = /^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m.exec(String(text).replace(/\r/g, ""));
  return m ? m[1] : undefined;
}

/**
 * Extract { version, headline } from every entry object of the curated
 * CHANGELOG_HISTORY array in src/lib/changelog.ts. String/comment-aware
 * bracket scanner: only keys at the entry object's own top level count, in any
 * field order (nested highlight objects are ignored).
 */
export function readHistory(source) {
  const decl = /CHANGELOG_HISTORY[^=]*=\s*\[/.exec(source);
  if (!decl) return [];
  const n = source.length;
  let i = decl.index + decl[0].length - 1; // at "["
  let depth = 0;
  let obj = null;
  const out = [];
  const readString = (q) => {
    let j = i + 1;
    while (j < n && source[j] !== q) j += source[j] === "\\" ? 2 : 1;
    const raw = source.slice(i + 1, j);
    i = j + 1;
    return raw;
  };
  while (i < n) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") { const e = source.indexOf("\n", i); i = e < 0 ? n : e + 1; continue; }
    if (c === "/" && source[i + 1] === "*") { const e = source.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'" || c === "`") { readString(c); continue; }
    if (c === "[" || c === "{" || c === "(") {
      depth++;
      if (c === "{" && depth === 2) obj = {};
      i++;
      continue;
    }
    if (c === "]" || c === "}" || c === ")") {
      if (c === "}" && depth === 2 && obj) {
        if (obj.version !== undefined && obj.headline !== undefined) out.push({ version: obj.version, headline: obj.headline });
        obj = null;
      }
      depth--;
      i++;
      if (depth === 0) break;
      continue;
    }
    if (depth === 2 && obj && /[A-Za-z_$]/.test(c)) {
      const key = /^[A-Za-z_$][\w$]*/.exec(source.slice(i, i + 64))[0];
      i += key.length;
      const sep = /^\s*:\s*/.exec(source.slice(i, i + 64));
      if (sep && (key === "version" || key === "headline")) {
        const q = source[i + sep[0].length];
        if (q === '"' || q === "'") {
          i += sep[0].length;
          const raw = readString(q);
          obj[key] = q === '"' ? JSON.parse(`"${raw}"`) : raw.replace(/\\(.)/g, "$1");
        }
      }
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Soft check for the local build (CI enforces a stricter rule on NEW files in
 * scripts/check-changes.mjs): a change pinned below the newest curated release.
 */
export function historyWarnings(changes, history) {
  const newest = maxVersion(history.map((h) => h.version));
  const versions = new Set(history.map((h) => h.version));
  return changes
    .filter((c) => !versions.has(c.version) && cmpVersion(c.version, newest) < 0)
    .map((c) => `changes/${c.slug}.md: version ${c.version} is lower than the newest release ${newest} — anyone who already saw ${newest} will never see it`);
}

/** The version a brand-new change note gets: one patch above everything known. */
/**
 * Every version that exists on a git ref (curated history + change files).
 *
 * WHY THIS EXISTS: `changes:new` used to read only the LOCAL working tree, so
 * a branch that was behind — or two branches open at once — happily minted the
 * same number. The loser's note then merged under the winner's headline and
 * vanished from What's New entirely. That happened four times in one day.
 *
 * `git` is injected (a function taking git args, returning stdout) so this
 * module stays free of child_process and remains unit-testable.
 */
export function versionsOnRef(git, ref) {
  const out = [];
  try {
    for (const h of readHistory(git("show", `${ref}:src/lib/changelog.ts`))) out.push(h.version);
  } catch { /* history file absent on that ref */ }
  let files = [];
  try {
    files = git("ls-tree", "--name-only", "-r", ref, "changes/").split("\n").filter(Boolean);
  } catch { /* no changes/ on that ref */ }
  for (const f of files) {
    if (!/^changes\/[^/]+\.md$/.test(f)) continue;
    try {
      const v = sniffVersion(git("show", `${ref}:${f}`));
      if (v) out.push(v);
    } catch { /* unreadable entry */ }
  }
  return out;
}

/**
 * Re-number unreleased notes so they sit above `floor`, preserving their
 * relative order. Returns [{ file, from, to }] for the ones that must move.
 * Notes already above the floor are left alone (their version is not churned).
 */
export function renumberAbove(notes, floor) {
  const moving = notes
    .filter((n) => cmpVersion(n.version, floor) <= 0)
    .sort((a, b) => cmpVersion(a.version, b.version) || a.file.localeCompare(b.file));
  // Versions already claimed by notes that do NOT need to move. A moved note
  // must not land on one of them — that would just trade one collision for
  // another.
  const taken = new Set(notes.filter((n) => cmpVersion(n.version, floor) > 0).map((n) => n.version));

  // Notes that DELIBERATELY share a version must keep sharing one. The house
  // rules bless grouping two notes into a single release (changes/README.md,
  // "the two OBS notes, 0.1.403"), and buildEntries renders them as ONE What's
  // New card with their highlights concatenated. Renumbering them apart would
  // split that card in two and surface a headline that was intentionally
  // suppressed — so a group is moved together, to one new version.
  const groups = new Map();
  for (const n of moving) {
    if (!groups.has(n.version)) groups.set(n.version, []);
    groups.get(n.version).push(n);
  }

  let next = floor;
  const out = [];
  for (const [, group] of groups) {
    do { next = bumpPatch(next); } while (taken.has(next));
    taken.add(next);
    for (const n of group) out.push({ file: n.file, from: n.version, to: next });
  }
  return out;
}

export function nextChangeVersion(history, changeVersions) {
  return bumpPatch(maxVersion([...history.map((h) => h.version), ...changeVersions]));
}

/**
 * Group parsed changes into ChangelogEntry objects (newest-first).
 * - A change whose version AND headline match a history entry is skipped (hand-merged).
 * - A change whose version exists in history with a different headline is an error.
 * - A change whose headline is used by a DIFFERENT history version is an error.
 */
export function buildEntries(changes, { history }) {
  const byVersion = new Map();
  const headlineVersion = new Map();
  for (const h of history) {
    if (!byVersion.has(h.version)) byVersion.set(h.version, new Set());
    byVersion.get(h.version).add(h.headline);
    if (!headlineVersion.has(h.headline)) headlineVersion.set(h.headline, h.version);
  }

  const pending = [];
  for (const c of changes) {
    const hv = byVersion.get(c.version);
    if (hv) {
      if (hv.has(c.headline)) continue;
      throw new Error(`changes/${c.slug}.md: version ${c.version} already exists in src/lib/changelog.ts history — give it a new version (npm run changes:new) or merge it there`);
    }
    if (headlineVersion.has(c.headline)) {
      throw new Error(`changes/${c.slug}.md: headline already used by version ${headlineVersion.get(c.headline)} — write a distinct headline`);
    }
    pending.push(c);
  }

  const groups = new Map();
  for (const c of pending) {
    if (!groups.has(c.version)) groups.set(c.version, []);
    groups.get(c.version).push(c);
  }
  const entries = [];
  for (const [version, list] of groups) {
    list.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const dates = list.map((c) => c.date).sort();
    entries.push({
      version,
      date: dates[dates.length - 1],
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
