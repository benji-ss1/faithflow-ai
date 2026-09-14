// Server-only. Do not import from client components.
//
// Phase 4 (slide actions + Automations) church-scoped DB CORE. Every function
// takes the caller's churchId EXPLICITLY — it is resolved from the session by
// the thin "use server" wrappers in src/lib/actions.ts and never from the
// client. Kept out of actions.ts on purpose: every export of a "use server"
// module is a client-callable endpoint, so a `(churchId, …)` signature there
// would let a client pick its own church. Split out so the adversarial
// cross-church test (test/adversarial/phase4-slide-actions-macros.test.ts) can
// exercise the REAL scoping SQL without an auth session.
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { macros, songSlides, songs, serviceItems, servicePlans, churches } from "../db/schema";
import { validateSlideActions, sanitizeSlideActions } from "../../engine/slide-actions";
import { validateMacroActions, sanitizeMacroActions, MAX_MACROS_PER_CHURCH } from "../../engine/macros";

type Db = ReturnType<typeof getDb>;
export type CoreResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

/** Max distinct slide-index keys in one item's sparse slideActions map. */
export const MAX_SLIDE_ACTION_KEYS = 500;
const MAX_SLIDE_INDEX = 5000;
const MAX_MACRO_NAME = 120;

/**
 * Remove any client-supplied `slideActions` from a service-item payload. ONLY
 * setServiceItemSlideActions may write that key (validated + sanitized). A
 * non-object payload is returned unchanged (the caller's shape guard rejects it).
 */
export function stripClientSlideActions<T>(payload: T): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, "slideActions")) return payload;
  const { slideActions: _drop, ...rest } = payload as Record<string, unknown>;
  void _drop;
  return rest as T;
}

// ── Slide actions ────────────────────────────────────────────────────────────

/** Persist a song slide's actions. Church-scoped (slide → song.churchId). */
export async function setSongSlideActionsCore(
  db: Db, churchId: string, slideId: string, actions: unknown,
): Promise<CoreResult<{ songId: string }>> {
  if (typeof slideId !== "string" || !slideId) return { ok: false, error: "Slide not found" };
  const [owned] = await db.select({ id: songSlides.id, songId: songSlides.songId })
    .from(songSlides)
    .innerJoin(songs, eq(songs.id, songSlides.songId))
    .where(and(eq(songSlides.id, slideId), eq(songs.churchId, churchId)))
    .limit(1);
  if (!owned) return { ok: false, error: "Slide not found" };
  const v = validateSlideActions(actions);
  if (!v.ok) return { ok: false, error: `Invalid slide action${v.index != null ? ` #${v.index + 1}` : ""}: ${v.reason}` };
  const clean = sanitizeSlideActions(actions);
  await db.update(songSlides).set({ actions: clean })
    .where(and(eq(songSlides.id, slideId), eq(songSlides.songId, owned.songId)));
  return { ok: true, data: { songId: owned.songId } };
}

/**
 * Persist a NON-song item's per-slide actions into payload.slideActions (sparse
 * `{ [slideIdx]: ActionSpec[] }`). ATOMIC single-key write: one UPDATE touches
 * only `payload.slideActions[key]` via jsonb_set / `#-`, so two concurrent saves
 * on different slides can't lose each other's keys (no read-modify-write), and
 * the key-count cap is evaluated against the row being updated. The UPDATE
 * itself carries the plan → church scoping.
 */
export async function setServiceItemSlideActionsCore(
  db: Db, churchId: string, itemId: string, slideIdx: number, actions: unknown,
): Promise<CoreResult> {
  if (typeof itemId !== "string" || !itemId) return { ok: false, error: "Item not found" };
  // Ownership pre-check gives an honest "not found" vs "limit reached" message;
  // the UPDATE below re-asserts the scoping, so this is not the security gate.
  const [item] = await db.select({ id: serviceItems.id })
    .from(serviceItems)
    .innerJoin(servicePlans, eq(servicePlans.id, serviceItems.servicePlanId))
    .where(and(eq(serviceItems.id, itemId), eq(servicePlans.churchId, churchId)))
    .limit(1);
  if (!item) return { ok: false, error: "Item not found" };
  if (!Number.isInteger(slideIdx) || slideIdx < 0 || slideIdx > MAX_SLIDE_INDEX) return { ok: false, error: "Bad slide index" };
  const v = validateSlideActions(actions);
  if (!v.ok) return { ok: false, error: `Invalid slide action: ${v.reason}` };
  const clean = sanitizeSlideActions(actions);
  const key = String(slideIdx);
  const isEmpty = clean.length === 0;
  const mapExpr = sql`(CASE WHEN jsonb_typeof(si.payload->'slideActions') = 'object' THEN si.payload->'slideActions' ELSE '{}'::jsonb END)`;
  const res = await db.execute(sql`
    UPDATE service_items AS si
    SET payload = CASE
      WHEN ${isEmpty}::boolean THEN
        CASE WHEN jsonb_typeof(si.payload->'slideActions') = 'object'
          THEN coalesce(si.payload, '{}'::jsonb) #- ARRAY['slideActions', ${key}]::text[]
          ELSE coalesce(si.payload, '{}'::jsonb) END
      ELSE jsonb_set(
        jsonb_set(coalesce(si.payload, '{}'::jsonb), '{slideActions}', ${mapExpr}, true),
        ARRAY['slideActions', ${key}]::text[], ${JSON.stringify(clean)}::jsonb, true)
    END
    FROM service_plans AS sp
    WHERE si.id = ${itemId}
      AND sp.id = si.service_plan_id
      AND sp.church_id = ${churchId}
      AND (
        ${isEmpty}::boolean
        OR jsonb_exists(${mapExpr}, ${key})
        OR (SELECT count(*) FROM jsonb_object_keys(${mapExpr})) < ${MAX_SLIDE_ACTION_KEYS}
      )
    RETURNING si.id`);
  const rows = (res as unknown as { rows?: unknown[] }).rows ?? [];
  if (rows.length === 0) {
    // Zero rows = either the item vanished / isn't this church's (deleted
    // between the pre-check and the UPDATE) or the key cap blocked it.
    const [still] = await db.select({ id: serviceItems.id })
      .from(serviceItems)
      .innerJoin(servicePlans, eq(servicePlans.id, serviceItems.servicePlanId))
      .where(and(eq(serviceItems.id, itemId), eq(servicePlans.churchId, churchId)))
      .limit(1);
    if (!still) return { ok: false, error: "Item not found" };
    return { ok: false, error: `Slide-action limit reached (${MAX_SLIDE_ACTION_KEYS} slides). Clear actions on another slide first.` };
  }
  return { ok: true };
}

// ── Automations (macros) ─────────────────────────────────────────────────────

export type MacroInput = { name?: unknown; actions?: unknown; enabled?: unknown };
export type MacroRow = { id: string; name: string; actions: unknown[]; enabled: boolean; sortOrder: number };

/** name: undefined → `fallback` (create default / "leave unchanged"); non-string
 *  → error; empty after trim → error. */
function normalizeName(raw: unknown, fallback: string | undefined): CoreResult<string | undefined> {
  if (raw === undefined) return { ok: true, data: fallback };
  if (typeof raw !== "string") return { ok: false, error: "Automation name must be text" };
  const name = raw.trim().slice(0, MAX_MACRO_NAME);
  if (!name) return { ok: false, error: "Automation name can't be empty" };
  return { ok: true, data: name };
}

function normalizeEnabled(raw: unknown, fallback: boolean | undefined): CoreResult<boolean | undefined> {
  if (raw === undefined) return { ok: true, data: fallback };
  if (typeof raw !== "boolean") return { ok: false, error: "Automation enabled must be true or false" };
  return { ok: true, data: raw };
}

function checkActions(raw: unknown): CoreResult<unknown[]> {
  const v = validateMacroActions(raw);
  if (!v.ok) return { ok: false, error: `Invalid action${v.index != null ? ` #${v.index + 1}` : ""}: ${v.reason}` };
  return { ok: true, data: sanitizeMacroActions(raw) };
}

export async function listMacrosCore(db: Db, churchId: string): Promise<MacroRow[]> {
  const rows = await db.select().from(macros)
    .where(eq(macros.churchId, churchId))
    .orderBy(asc(macros.sortOrder), asc(macros.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, actions: sanitizeMacroActions(r.actions), enabled: r.enabled, sortOrder: r.sortOrder }));
}

/**
 * Create an Automation. Cap-safe under concurrency: the church row is locked
 * (`SELECT … FOR UPDATE`) inside a transaction, so parallel creates for the same
 * church serialize their count + insert and can never exceed the cap.
 */
export async function createMacroCore(db: Db, churchId: string, input: MacroInput): Promise<CoreResult<{ id: string }>> {
  const inp = (input && typeof input === "object") ? input : {};
  const n = normalizeName(inp.name, "Automation");
  if (!n.ok) return n;
  const e = normalizeEnabled(inp.enabled, true);
  if (!e.ok) return e;
  const a = checkActions(inp.actions === undefined ? [] : inp.actions);
  if (!a.ok) return a;
  return db.transaction(async (tx) => {
    const [ch] = await tx.select({ id: churches.id }).from(churches).where(eq(churches.id, churchId)).for("update");
    if (!ch) return { ok: false, error: "Church not found" } as const;
    const [agg] = await tx.select({
      n: sql<number>`count(*)::int`,
      maxOrder: sql<number | null>`max(${macros.sortOrder})`,
    }).from(macros).where(eq(macros.churchId, churchId));
    if ((agg?.n ?? 0) >= MAX_MACROS_PER_CHURCH) {
      return { ok: false, error: `Automation limit reached (${MAX_MACROS_PER_CHURCH}). Delete one to add another.` } as const;
    }
    const nextOrder = agg?.maxOrder == null ? 0 : Number(agg.maxOrder) + 1;
    const [row] = await tx.insert(macros).values({
      churchId, name: n.data as string, actions: a.data as unknown[], enabled: e.data as boolean, sortOrder: nextOrder,
    }).returning({ id: macros.id });
    return { ok: true, data: { id: row.id } } as const;
  });
}

/** PARTIAL update — only provided fields are touched. Church-scoped. */
export async function updateMacroCore(db: Db, churchId: string, id: string, input: MacroInput): Promise<CoreResult> {
  if (typeof id !== "string" || !id) return { ok: false, error: "Automation not found" };
  const inp = (input && typeof input === "object") ? input : {};
  const patch: Partial<{ name: string; actions: unknown[]; enabled: boolean; updatedAt: Date }> = { updatedAt: new Date() };
  const n = normalizeName(inp.name, undefined);
  if (!n.ok) return n;
  if (n.data !== undefined) patch.name = n.data;
  const e = normalizeEnabled(inp.enabled, undefined);
  if (!e.ok) return e;
  if (e.data !== undefined) patch.enabled = e.data;
  if (inp.actions !== undefined) {
    const a = checkActions(inp.actions);
    if (!a.ok) return a;
    patch.actions = a.data;
  }
  const rows = await db.update(macros).set(patch)
    .where(and(eq(macros.id, id), eq(macros.churchId, churchId)))
    .returning({ id: macros.id });
  if (rows.length === 0) return { ok: false, error: "Automation not found" };
  return { ok: true };
}

export async function deleteMacroCore(db: Db, churchId: string, id: string): Promise<CoreResult> {
  if (typeof id !== "string" || !id) return { ok: false, error: "Automation not found" };
  const rows = await db.delete(macros)
    .where(and(eq(macros.id, id), eq(macros.churchId, churchId)))
    .returning({ id: macros.id });
  if (rows.length === 0) return { ok: false, error: "Automation not found" };
  return { ok: true };
}
