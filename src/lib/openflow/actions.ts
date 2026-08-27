"use server";
/*
 * OpenFlow server actions for Increment 2 — grounding + Apply-to-Service.
 * Everything here is church-scoped (churchId from the session via requireCap)
 * and NEVER trusts the model for facts: scripture text comes from the Bible DB
 * (lookupReference), songs are matched against THIS church's real library, and
 * a plan is applied through the same addServiceItem the rest of the app uses
 * (auth-gated, validated, deduped).
 */
import { requireCap } from "@/lib/session";
import { parseReference } from "@/lib/bible-parser";
import { listTranslations, lookupReference } from "@/lib/server/bible";
import { listSongs } from "@/lib/server/services";
import { addServiceItem, addServiceItems } from "@/lib/actions";
import type { ServicePlanBlock } from "@/lib/openflow/parse";
import { matchSongIndex, formatScriptureLabel, lookupVerseEnd } from "@/lib/openflow/resolve-helpers";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Resolve a free-text reference to REAL verse text from the DB (never the LLM).
 *  Handles single verse, same-chapter range, cross-chapter range, and whole
 *  chapter. */
export async function resolveOpenFlowScripture(
  reference: string,
  translationCode?: string,
): Promise<Result<{ reference: string; translation: string; verses: { verse: number; text: string }[] }>> {
  const user = await requireCap("operate_services");
  const parsed = parseReference(reference);
  if (!parsed) return { ok: false, error: `Couldn't read the reference "${reference}".` };
  const translations = await listTranslations();
  const t = (translationCode && translations.find((x) => x.code === translationCode))
    || translations.find((x) => x.code === "KJV") || translations[0];
  if (!t) return { ok: false, error: "No Bible translation is available." };
  const verses = await lookupReference(
    t.id, parsed.book, parsed.chapter, parsed.verseStart, lookupVerseEnd(parsed),
    parsed.chapterEnd, t.code, user.churchId,
  );
  if (!verses.length) return { ok: false, error: `No text found for "${reference}".` };
  const refLabel = formatScriptureLabel(parsed);
  return { ok: true, data: { reference: refLabel, translation: t.code, verses: verses.map((v) => ({ verse: v.verse, text: v.text })) } };
}

/** Add one scripture reference to the plan (resolving real text first). */
export async function addOpenFlowScriptureToPlan(planId: string, reference: string, translationCode?: string): Promise<Result> {
  const r = await resolveOpenFlowScripture(reference, translationCode);
  if (!r.ok) return r;
  const res = await addServiceItem(planId, "scripture", r.data!.reference, { reference: r.data!.reference, verses: r.data!.verses });
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "Couldn't add that verse." };
}

/** Add one song to the plan by matching its title to THIS church's library. */
export async function addOpenFlowSongToPlan(planId: string, title: string): Promise<Result<{ matched: string }>> {
  const user = await requireCap("operate_services");
  const lib = await listSongs(user.churchId);
  const idx = matchSongIndex(lib.map((s) => s.title), title);
  if (idx < 0) return { ok: false, error: `"${title}" isn't in your library yet.` };
  const hit = lib[idx];
  const res = await addServiceItem(planId, "song", hit.title, { songId: hit.id });
  return res.ok ? { ok: true, data: { matched: hit.title } } : { ok: false, error: res.error ?? "Couldn't add that song." };
}

/**
 * Apply a whole generated plan to the running order. Songs are matched to the
 * library (unmatched ones are reported, never invented); scripture is resolved
 * to real text; sermon/media/other blocks become a labelled placeholder so the
 * running order stays complete. Resolved items are inserted in ONE batch
 * (addServiceItems — auth-gated, validated, deduped) so the reported counts are
 * honest and the write is a single round-trip.
 */
export async function applyOpenFlowServicePlan(
  planId: string,
  blocks: ServicePlanBlock[],
): Promise<Result<{ added: number; skipped: string[] }>> {
  const user = await requireCap("operate_services");
  const lib = await listSongs(user.churchId);
  const libTitles = lib.map((s) => s.title);

  const items: { type: "song" | "scripture" | "sermon" | "blank"; title: string; payload: Record<string, unknown> }[] = [];
  const skipped: string[] = []; // suggested content we could NOT ground (not in library / unresolvable ref)

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block.type === "songs") {
      for (const title of block.items) {
        const idx = matchSongIndex(libTitles, title);
        if (idx < 0) { skipped.push(title); continue; }
        items.push({ type: "song", title: lib[idx].title, payload: { songId: lib[idx].id } });
      }
    } else if (block.type === "scripture") {
      for (const ref of block.items) {
        const r = await resolveOpenFlowScripture(ref);
        if (!r.ok) { skipped.push(ref); continue; }
        items.push({ type: "scripture", title: r.data!.reference, payload: { reference: r.data!.reference, verses: r.data!.verses } });
      }
    } else {
      // sermon → sermon placeholder; media/other → blank. Empty payload per the
      // addServiceItem validator; keeps the running-order structure.
      items.push({ type: block.type === "sermon" ? "sermon" : "blank", title: block.name, payload: {} });
    }
  }

  if (items.length === 0) return { ok: true, data: { added: 0, skipped } };
  const res = await addServiceItems(planId, items);
  if (!res.ok) return { ok: false, error: res.error ?? "Couldn't apply the plan." };
  // addServiceItems reports real inserts vs dedup skips — `inserted` is honest.
  return { ok: true, data: { added: res.data?.inserted ?? 0, skipped } };
}
