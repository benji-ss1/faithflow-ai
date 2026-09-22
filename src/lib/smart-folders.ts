/**
 * Smart Folders — rule-based, auto-populating libraries (ProPresenter parity).
 *
 * A MANUAL library owns membership: a song/media row carries its `library_id`.
 * A SMART folder owns NOTHING. Its contents are computed at query time from a
 * rule set, so it can never drift out of sync and deleting it can never orphan
 * content (it has no membership rows at all).
 *
 * This module is deliberately PURE and free of DB/session imports so the rule
 * semantics are unit-testable in isolation. The only DB-facing function is
 * `compileRules`, which returns a parameterised Drizzle `SQL` fragment — it
 * NEVER interpolates a user value into SQL text.
 *
 * SECURITY (CLAUDE.md rule 5): the fragment returned here is a CONTENT
 * predicate only. It is always `and()`-ed with `eq(table.churchId, …)` by the
 * caller in src/lib/server/services.ts — this module must never be the only
 * thing standing between one church and another's data.
 */

import { sql, type SQL } from "drizzle-orm";

export type SmartTarget = "songs" | "media";
/** The only table names that may reach sql.raw — a literal union, not a string. */
export type SmartTable = "songs" | "media_assets";
export type MatchMode = "all" | "any";

export type SmartOp =
  | "contains" | "notContains" | "is" | "isNot"
  | "startsWith" | "endsWith"
  | "isSet" | "isNotSet"
  | "gt" | "lt"
  | "inLastDays" | "before" | "after";

export type SmartRule = { field: string; op: SmartOp; value?: string };
export type SmartRules = { match: MatchMode; rules: SmartRule[] };

/** Hard cap — a rule set is operator-authored UI state, not a query language. */
export const MAX_RULES = 12;

type FieldKind = "text" | "number" | "date" | "enum";
type FieldDef = { column: string; kind: FieldKind; label: string; options?: string[] };

/**
 * The queryable surface. Only columns listed here can ever reach SQL, so an
 * attacker-supplied `field` can never name an arbitrary column — the lookup
 * fails closed and the rule is dropped during validation.
 */
export const SMART_FIELDS: Record<SmartTarget, Record<string, FieldDef>> = {
  songs: {
    title: { column: "title", kind: "text", label: "Title" },
    artist: { column: "artist", kind: "text", label: "Artist" },
    source: { column: "source", kind: "enum", label: "Source", options: ["public_domain", "church", "imported"] },
    createdAt: { column: "created_at", kind: "date", label: "Date added" },
    background: { column: "default_background_asset_id", kind: "text", label: "Background" },
  },
  // NOTE: smart folders are SONGS-only today. Both write paths validate with
  // target "songs" and the rule editor only offers song fields, so a media
  // field map here would be unreachable config that silently produced
  // incoherent counts. Add it back together with a `target` column on
  // `libraries` when churches ask for media smart folders.
  media: {
    createdAt: { column: "created_at", kind: "date", label: "Date added" },
  },
};

/** Which operators are meaningful for each field kind. */
const OPS_BY_KIND: Record<FieldKind, SmartOp[]> = {
  text: ["contains", "notContains", "is", "isNot", "startsWith", "endsWith", "isSet", "isNotSet"],
  enum: ["is", "isNot", "isSet", "isNotSet"],
  number: ["is", "isNot", "gt", "lt", "isSet", "isNotSet"],
  date: ["inLastDays", "before", "after"],
};

/** Operators that need no `value` (so an empty value is legitimate). */
const VALUELESS: ReadonlySet<SmartOp> = new Set(["isSet", "isNotSet"]);

export function opsForField(target: SmartTarget, field: string): SmartOp[] {
  const def = SMART_FIELDS[target]?.[field];
  return def ? OPS_BY_KIND[def.kind] : [];
}

/**
 * Validate + normalise an untrusted rule set (it arrives from a jsonb column
 * and from client input). Unknown fields, mismatched operators, and malformed
 * values are DROPPED rather than rejected wholesale, so one bad rule can never
 * make an existing folder un-openable — it just stops narrowing.
 */
export function validateRules(input: unknown, target: SmartTarget): SmartRules {
  const empty: SmartRules = { match: "all", rules: [] };
  if (!input || typeof input !== "object") return empty;
  const raw = input as { match?: unknown; rules?: unknown };
  const match: MatchMode = raw.match === "any" ? "any" : "all";
  if (!Array.isArray(raw.rules)) return { match, rules: [] };

  const out: SmartRule[] = [];
  for (const r of raw.rules) {
    if (out.length >= MAX_RULES) break;
    if (!r || typeof r !== "object") continue;
    const { field, op, value } = r as { field?: unknown; op?: unknown; value?: unknown };
    if (typeof field !== "string" || typeof op !== "string") continue;

    const def = SMART_FIELDS[target]?.[field];
    if (!def) continue;                                   // fails closed
    if (!OPS_BY_KIND[def.kind].includes(op as SmartOp)) continue;

    const o = op as SmartOp;
    if (VALUELESS.has(o)) { out.push({ field, op: o }); continue; }

    if (typeof value !== "string") continue;
    const v = value.trim().slice(0, 200);
    if (!v) continue;
    if (def.kind === "number" && !Number.isFinite(Number(v))) continue;
    if (def.kind === "enum" && def.options && !def.options.includes(v)) continue;
    if (o === "inLastDays") {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0 || n > 3650) continue;
    }
    if ((o === "before" || o === "after") && Number.isNaN(Date.parse(v))) continue;

    out.push({ field, op: o, value: v });
  }
  return { match, rules: out };
}

/** Escape LIKE wildcards so a literal % or _ in a title matches literally. */
function likeLiteral(v: string): string {
  return v.replace(/([\\%_])/g, "\\$1");
}

/**
 * Compile ONE rule to a parameterised SQL fragment.
 *
 * `tableAlias.column` is assembled from the whitelist above — never from user
 * input — and every VALUE is bound via Drizzle's `${}` parameter slot.
 */
function compileRule(rule: SmartRule, target: SmartTarget, table: SmartTable): SQL | null {
  const def = SMART_FIELDS[target]?.[rule.field];
  if (!def) return null;
  // Defence in depth: callers always validate first, but if anyone ever
  // compiles unvalidated input a mismatched op (e.g. `gt` on a date) would
  // emit `created_at > NaN` and 500. Re-check rather than trust.
  if (!OPS_BY_KIND[def.kind].includes(rule.op)) return null;
  // Safe: `table` is a literal from our own caller and `def.column` is
  // whitelisted, so this identifier can never carry user input.
  const col = sql.raw(`"${table}"."${def.column}"`);
  const v = rule.value ?? "";

  switch (rule.op) {
    case "contains":    return sql`${col}::text ILIKE ${"%" + likeLiteral(v) + "%"}`;
    case "notContains": return sql`(${col} IS NULL OR ${col}::text NOT ILIKE ${"%" + likeLiteral(v) + "%"})`;
    case "startsWith":  return sql`${col}::text ILIKE ${likeLiteral(v) + "%"}`;
    case "endsWith":    return sql`${col}::text ILIKE ${"%" + likeLiteral(v)}`;
    // Numbers compare numerically so "1e3" / "1000.0" / " 1000" behave the
    // same way they do for gt/lt. Text/enum keep the ::text cast.
    case "is":          return def.kind === "number"
                          ? sql`${col} = ${Number(v)}`
                          : sql`${col}::text = ${v}`;
    case "isNot":       return def.kind === "number"
                          ? sql`(${col} IS NULL OR ${col} <> ${Number(v)})`
                          : sql`(${col} IS NULL OR ${col}::text <> ${v})`;
    case "isSet":       return sql`${col} IS NOT NULL`;
    case "isNotSet":    return sql`${col} IS NULL`;
    case "gt":          return sql`${col} > ${Number(v)}`;
    case "lt":          return sql`${col} < ${Number(v)}`;
    case "before":      return sql`${col} < ${new Date(v)}`;
    case "after":       return sql`${col} > ${new Date(v)}`;
    case "inLastDays":  return sql`${col} > now() - ${`${Number(v)} days`}::interval`;
    default:            return null;
  }
}

/**
 * Compile a whole rule set to a single predicate.
 *
 * Returns null when there are no usable rules. A null result MUST be treated
 * by the caller as "this smart folder matches NOTHING" — never as "no filter",
 * which would show the church's entire library under an empty folder.
 */
export function compileRules(rules: SmartRules, target: SmartTarget, table: SmartTable): SQL | null {
  const parts = rules.rules
    .map((r) => compileRule(r, target, table))
    .filter((p): p is SQL => p !== null);
  if (parts.length === 0) return null;

  // Parenthesise EVERY fragment, not just the whole set. Today all fragments
  // happen to be atomic or self-wrapped, but a future op emitting a bare
  // `x OR y` would otherwise turn `match:"all"` into `a AND x OR y`
  // = `(a AND x) OR y` — silently returning MORE rows than the rules ask for.
  const joiner = rules.match === "any" ? sql` OR ` : sql` AND `;
  let acc: SQL = sql`(${parts[0]})`;
  for (let i = 1; i < parts.length; i++) acc = sql`${acc}${joiner}(${parts[i]})`;
  return sql`(${acc})`;
}

/** Human-readable summary for the rail tooltip / rule editor header. */
export function describeRules(rules: SmartRules, target: SmartTarget): string {
  if (rules.rules.length === 0) return "No rules yet — matches nothing";
  const join = rules.match === "any" ? " or " : " and ";
  return rules.rules
    .map((r) => {
      const label = SMART_FIELDS[target]?.[r.field]?.label ?? r.field;
      const op = r.op.replace(/([A-Z])/g, " $1").toLowerCase();
      return r.value ? `${label} ${op} "${r.value}"` : `${label} ${op}`;
    })
    .join(join);
}
