/**
 * ProPresenter playlist manifest (`data`) parser.
 *
 * Every ProPresenter ZIP container (.proPlaylist / .prolib / .proBundle)
 * carries a protobuf file literally named `data` alongside the `.pro`
 * documents. It holds the PLAYLIST NAME and, crucially, the SERVICE ORDER —
 * which is NOT the alphabetical order the ZIP entries come back in.
 *
 * Verified against a real Kings Court export ("Sept 20.proPlaylist"):
 *   ZIP entry order : Another one no dey o, Dependable Jesus, Halle intro, …
 *   Manifest order  : Halle intro, Song of Ages, Your Name is Yahweh, …
 * The second one is what the worship team actually planned.
 *
 * WHY THIS IS A TOLERANT WALK, NOT A SCHEMA
 *   Renewed Vision does not publish the .proto, and every community schema
 *   drifts between PP7 minors (same reasoning as pro7-parser.ts). Hardcoding
 *   `.3.12.1.13.1.2` would break on the next release and fail SILENTLY —
 *   the worst outcome. So we walk the protobuf generically and recognise a
 *   playlist ITEM structurally:
 *
 *     an item = a message that has BOTH a printable string field #2 (its
 *     title) AND, somewhere beneath it, a string ending in `.pro`
 *
 *   That shape has been stable across every PP7 export we have seen, and if
 *   it ever stops matching we return an empty list — callers then fall back
 *   to ZIP order, which is exactly today's behaviour. Degrades, never breaks.
 *
 * SECURITY: input is an untrusted upload. Every read is bounds-checked, the
 * walk is depth- and item-capped, and the parser NEVER throws.
 */

export type ManifestItem = {
  /** ProPresenter's UUID for the playlist entry, when present. */
  uuid: string | null;
  /** Display title as the operator saw it in ProPresenter. */
  title: string;
  /** Relative source path, e.g. "Libraries/Default/Halle intro.pro". */
  sourcePath: string | null;
};

export type ParsedManifest = {
  /** Playlist name ("Sept 20"), or null if we couldn't identify one. */
  name: string | null;
  /** Items in SERVICE order. Empty if the manifest didn't match. */
  items: ManifestItem[];
  warnings: string[];
};

const MAX_DEPTH = 12;
const MAX_ITEMS = 5000;

/**
 * Total decode operations allowed for ONE manifest, shared across the whole
 * walk.
 *
 * WHY A SHARED BUDGET AND NOT JUST DEPTH CAPS (adversarial review, 2026-09-22):
 * the first version passed a fresh `depth` of 0 into every nested helper, so
 * the caps bounded each CALL but not the TOTAL work — `findName` re-walked a
 * whole subtree at every node, and `collect` re-walked it again per item. The
 * cost was O(n · depth²) with a big constant. A crafted 57 KB upload (a
 * deflate-friendly nested tree, 163:1 ratio) was measured blocking the Node
 * event loop for ~50 SECONDS, and `runImportPipeline` is synchronous, so the
 * whole instance stalls. A shared, decrementing budget makes the work linear
 * and bounded no matter how the input is shaped.
 */
const MAX_STEPS = 200_000;

/** Mutable walk state — one per parse, threaded through every helper. */
type Budget = { steps: number };

type Field =
  | { field: number; kind: "bytes"; value: Buffer }
  | { field: number; kind: "varint"; value: number };

/** Read a base-128 varint. Returns null on truncation or absurd length. */
function readVarint(b: Buffer, off: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let i = off;
  while (i < b.length) {
    const c = b[i++];
    value += (c & 0x7f) * Math.pow(2, shift);
    shift += 7;
    if (!(c & 0x80)) return { value, next: i };
    if (shift > 63) return null;
  }
  return null;
}

/** Decode one protobuf message into its top-level fields. Never throws. */
function decodeFields(b: Buffer, budget: Budget): Field[] {
  const out: Field[] = [];
  let i = 0;
  while (i < b.length) {
    if (--budget.steps <= 0) break;
    const key = readVarint(b, i);
    if (!key) break;
    i = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 7;
    if (field === 0) break;
    if (wire === 2) {
      const len = readVarint(b, i);
      if (!len) break;
      i = len.next;
      if (len.value < 0 || i + len.value > b.length) break;
      out.push({ field, kind: "bytes", value: b.subarray(i, i + len.value) });
      i += len.value;
    } else if (wire === 0) {
      const v = readVarint(b, i);
      if (!v) break;
      out.push({ field, kind: "varint", value: v.value });
      i = v.next;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      break; // groups (3/4) are obsolete and never appear here
    }
  }
  return out;
}

/**
 * True if the buffer is entirely printable UTF-8-ish text.
 *
 * Checks the bytes BEFORE calling toString so a crafted all-printable payload
 * can't make us allocate a multi-megabyte string at every level of the walk.
 */
function asText(b: Buffer): string | null {
  if (b.length === 0 || b.length > 4096) return null;
  for (const c of b) if (c < 0x20 || c === 0x7f) return null;
  const s = b.toString("utf8");
  return s.length > 0 ? s : null;
}

/** Depth-first search for the first string ending in `.pro` beneath a node. */
function findProPath(b: Buffer, depth: number, budget: Budget): string | null {
  if (depth > MAX_DEPTH || budget.steps <= 0) return null;
  for (const f of decodeFields(b, budget)) {
    if (f.kind !== "bytes") continue;
    const t = asText(f.value);
    if (t) {
      if (/\.pro$/i.test(t.trim())) return t.trim();
      continue;
    }
    const nested = findProPath(f.value, depth + 1, budget);
    if (nested) return nested;
  }
  return null;
}

/** First UUID-shaped string beneath a node. */
function findUuid(b: Buffer, depth: number, budget: Budget): string | null {
  if (depth > MAX_DEPTH || budget.steps <= 0) return null;
  for (const f of decodeFields(b, budget)) {
    if (f.kind !== "bytes") continue;
    const t = asText(f.value);
    if (t && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return t;
    if (!t) {
      const nested = findUuid(f.value, depth + 1, budget);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Collect playlist items, DEEPEST-FIRST.
 *
 * The outer playlist node also has a title (field #2) and a `.pro` path
 * somewhere beneath it, so a naive top-down match returns the playlist itself
 * as a single "item". We therefore recurse FIRST and only fall back to
 * treating a node as an item when nothing deeper matched.
 *
 * `depth` is threaded honestly (never reset), and every helper shares one
 * step budget — see MAX_STEPS.
 */
function collect(b: Buffer, depth: number, items: ManifestItem[], budget: Budget): void {
  if (depth > MAX_DEPTH || items.length >= MAX_ITEMS || budget.steps <= 0) return;
  for (const f of decodeFields(b, budget)) {
    if (f.kind !== "bytes") continue;
    if (asText(f.value)) continue; // a leaf string is never an item

    // Deeper wins: a real item never contains further items.
    const before = items.length;
    collect(f.value, depth + 1, items, budget);
    if (items.length > before) continue;
    if (budget.steps <= 0) return;

    const kids = decodeFields(f.value, budget);
    const titleField = kids.find((k) => k.field === 2 && k.kind === "bytes") as { value: Buffer } | undefined;
    const title = titleField ? asText(titleField.value) : null;
    // A DISPLAY title is never a file path. Without this guard the walk
    // descends into the document-reference node, whose own field #2 is
    // "Libraries/Default/Halle intro.pro", and reports paths as titles.
    if (!title || /[/\\]/.test(title) || /\.pro$/i.test(title.trim())) continue;
    const proPath = findProPath(f.value, depth + 1, budget);
    if (!proPath) continue;

    items.push({ uuid: findUuid(f.value, depth + 1, budget), title: title.trim(), sourcePath: proPath });
    if (items.length >= MAX_ITEMS) return;
  }
}

/**
 * Find the playlist name: the DEEPEST node carrying a field #2 string whose
 * subtree contains items.
 *
 * Deepest-first matches `collect`'s own convention, so a nested playlist group
 * ("Services" → "Sept 20") yields the playlist name, not the group name.
 */
function findName(b: Buffer, depth: number, budget: Budget): string | null {
  if (depth > MAX_DEPTH || budget.steps <= 0) return null;
  for (const f of decodeFields(b, budget)) {
    if (f.kind !== "bytes" || asText(f.value)) continue;

    const deeper = findName(f.value, depth + 1, budget);
    if (deeper) return deeper;

    const kids = decodeFields(f.value, budget);
    const nameField = kids.find((k) => k.field === 2 && k.kind === "bytes") as { value: Buffer } | undefined;
    const name = nameField ? asText(nameField.value) : null;
    if (!name || /[/\\]/.test(name) || /\.pro$/i.test(name.trim())) continue;

    const probe: ManifestItem[] = [];
    collect(f.value, depth + 1, probe, budget);
    if (probe.length > 0) return name.trim();
  }
  return null;
}

/** Parse a ProPresenter `data` manifest. Always returns; never throws. */
export function parsePlaylistManifest(buf: Buffer): ParsedManifest {
  const warnings: string[] = [];
  if (!buf || buf.length === 0) {
    return { name: null, items: [], warnings: ["Manifest is empty"] };
  }
  // A real playlist manifest is a few KB (the Kings Court 7-song export is
  // 2.1 KB). Anything vastly larger is not a service plan.
  if (buf.length > 2 * 1024 * 1024) {
    return { name: null, items: [], warnings: ["Playlist manifest too large — using file order"] };
  }
  // One shared budget for the WHOLE parse (items + name), so a crafted
  // manifest cannot multiply the work by re-walking subtrees.
  const budget: Budget = { steps: MAX_STEPS };
  try {
    const items: ManifestItem[] = [];
    collect(buf, 0, items, budget);
    const name = findName(buf, 0, budget);
    if (items.length === 0) {
      warnings.push("Playlist manifest did not match a known shape — falling back to file order");
    } else if (budget.steps <= 0) {
      warnings.push("Playlist manifest was unusually large — order may be incomplete");
    }
    return { name, items, warnings };
  } catch {
    // Belt and braces: a malformed upload must never fail the whole import.
    return { name: null, items: [], warnings: ["Playlist manifest could not be read — using file order"] };
  }
}

/**
 * Order parsed songs by the playlist manifest.
 *
 * Matching is by the `.pro` BASENAME, which is how the ZIP entries are named.
 * Anything the manifest doesn't mention is appended in its original order —
 * we never DROP a song just because the manifest disagrees.
 */
export function orderByManifest<T>(
  songs: T[],
  manifest: ParsedManifest,
  basenameOf: (song: T) => string,
): T[] {
  if (manifest.items.length === 0) return songs;
  const rank = new Map<string, number>();
  manifest.items.forEach((it, i) => {
    const base = (it.sourcePath || it.title).split(/[/\\]/).pop() || "";
    const key = base.replace(/\.pro$/i, "").trim().toLowerCase();
    if (key && !rank.has(key)) rank.set(key, i);
  });
  return songs
    .map((s, i) => ({ s, i, r: rank.get(basenameOf(s).trim().toLowerCase()) }))
    .sort((a, b) => {
      if (a.r === undefined && b.r === undefined) return a.i - b.i;
      if (a.r === undefined) return 1;  // unknown → after known
      if (b.r === undefined) return -1;
      return a.r - b.r;
    })
    .map((x) => x.s);
}
