# ProPresenter import — scaling gap audit (2026-09-22)

**Scope:** the ProPresenter import path at real-church scale.
**Method:** code-evidence only. Every number is derived from a constant or a
measured data point in the repo, not estimated from intuition.

**Anchor data point** (from `src/lib/pro-bundle-strip.ts:5-7`, measured on a
real export): **171 MB .proBundle = 559 songs = 5.4 MB of lyrics.**
Scaling linearly to a 6,600-song library: **~2.0 GB raw, ~64 MB of lyrics,
~85 MB once base64-encoded.**

> ## 🔴 Bottom line
> **A 6,600-song ProPresenter library cannot be imported today.** It is
> rejected in the *browser* at `MAX_RAW_INPUT_BYTES` (600 MB) before a single
> byte reaches the server. Even the stripped 64 MB of lyrics exceeds both the
> 45 MB client gate and, on the wizard path, Vercel's request-body limit.
>
> The Kings Court playlist that prompted this work is 7 songs / 16 KB, so it is
> nowhere near these limits. This audit is about the churches with a decade of
> library behind them.

---

## 1. Memory — everything is held whole in RAM; nothing streams

| | Finding | File |
|---|---|---|
| 🔴 | `MAX_RAW_INPUT_BYTES = 600 MB` and `await f.arrayBuffer()` — a ~2 GB export is refused outright, and the user sees only a vague "Some content was skipped (over safe size limits)" | `pro-bundle-strip.ts:34,72-73`; toast at `ProPresenterImportDialog.tsx:258` |
| 🔴 | `MAX_TOTAL_DECOMP_BYTES = 80 MB` vs ~64 MB of lyrics at 6,600 songs — right at the cliff, and a lyric-heavier library truncates **mid-library with no count of what was dropped** | `pro-bundle-strip.ts:36,83` |
| 🔴 | `bytesToBase64` builds a `String.fromCharCode` string (UTF-16, 2 bytes/char) then `btoa`. For 64 MB of docs that is ~64 MB array + ~128 MB binary string + ~170 MB b64-as-UTF-16 ≈ **380 MB**, retained for the whole session in `scannedDropsRef`. Tab OOM is the realistic outcome | `ProPresenterImportDialog.tsx:64-71,230,262` |
| 🔴 | Server side the payload is copied ~4-5× (Buffers → `aggregate.songs` → `markedSongs` → `summary.songs` → `JSON.stringify`), and the result is written to a **single JSONB row holding every slide of every song** | `api/imports/parse/route.ts:114-120,191,218,233-235` |

## 2. Time — avoidable repeated full-buffer work

| | Finding | File |
|---|---|---|
| 🔴 | `bulkInsertSongs` runs `SELECT title FROM songs WHERE church_id = ?` with **no limit**, on every call. At `IMPORT_BATCH_SIZE = 40` a 6,600-song import is 165 batches (plus 165 preview calls) ⇒ **~330 full-table title scans ≈ 1.1 M rows shipped**. Quadratic in library size | `song-bulk-insert.ts:41-43`; batch size `ProPresenterImportDialog.tsx:91` |
| 🟡 | For every RTF block, `bestLabel` re-scans **all** labels — O(blocks × labels) — while the linear `li` cursor is already computed and thrown away | `pro7-parser.ts:281-285` |
| 🟡 | `findRtfBlocks` is run **twice per file** (once per cue in `reorderPro7ByArrangement`, once at the top level) | `pro7-parser.ts:214,246` |
| 🟡 | `runs.map().join(" \x01 ")` builds a **full-file-sized string copy** purely to regex for CCLI/artist | `pro7-parser.ts:84-103,312` |

## 3. Request limits — the declared caps are fiction

| | Finding | File |
|---|---|---|
| 🔴 | `MAX_BUNDLE_BYTES = 500 MB` and `MAX_TOTAL_BYTES = 250 MB` are **unreachable on Vercel**. Server Actions are capped at `bodySizeLimit: "50mb"` and the platform function body limit is far lower. The dialog only works because it batches ~40 docs (~0.5 MB) per call. These constants actively mislead | `pipeline.ts:16`; `import-actions.ts:18`; `next.config.ts:50` |
| 🔴 | The wizard appends **all** stripped docs into one `FormData` and POSTs once ⇒ a 413 before the route's own size check ever runs. `chunkDocsByBytes` exists for exactly this and **is referenced nowhere** — dead code | `WizardClient.tsx:113-135`; `pro-bundle-strip.ts:110` |
| 🟡 | The media route is limited to **10 uploads/hour/church** while the wizard posts one file per request — the 11th file is a 429. The dialog's server-action path has no rate limit at all | `api/media/presign/route.ts:47` |

## 4. Database

| | Finding | File |
|---|---|---|
| 🟢 | Song inserts are genuinely batched: chunked multi-row INSERTs inside one transaction per call | `song-bulk-insert.ts:78-101` |
| 🔴 | The transaction boundary is **per 40-song batch**, so a 6,600-song import is 165 independent commits — no global atomicity | same |
| 🔴 | Background linking issues **one `UPDATE songs` per song, serially**; the media loop is serial `putBuffer` + thumbnail + `putBuffer` + `INSERT` (4 round trips × N) | `import-actions.ts:167-201,220-234` |

## 5. Failure modes

- 🔴 **No resume.** Progress lives only in React state; closing the tab mid-run
  strands a partially imported library with no record of where it stopped.
- 🟡 A batch that fails all retries reports only *"N song document(s) failed"* —
  **no list of which ones**.
- 🟡 A `migrationJobs` row is created before streaming; if the stream dies it
  stays `processing` forever and nothing reaps it.

## 6. Recommendations, ranked by value ÷ effort

1. 🔴 **Wire the existing `chunkDocsByBytes` into `WizardClient`** (~3 MB/request).
   Already written, currently dead. Highest value, near-zero effort.
2. 🔴 **Hoist the title set out of `bulkInsertSongs`** — accept a preloaded `Set`,
   or use `INSERT … ON CONFLICT DO NOTHING` with a unique index on
   `(church_id, lower(title))`. Kills ~330 full scans.
3. 🔴 **Drop base64 on the dialog path** — POST multipart to the parse route
   instead of through a Server Action. Removes the 1.33× inflation and the
   128 MB intermediate string. Biggest memory win.
4. 🟡 **Realign or delete the dead caps** (500 MB / 250 MB) to the real
   per-request ceiling and document it, so the limits stop lying.
5. 🔴 **Persist import progress server-side** (a batch cursor on `migrationJobs`)
   so a closed tab can resume; reap stale `processing` jobs.
6. 🔴 **Stop storing full slides in `summaryJson`** — stage to a table or S3.
7. 🟡 **Parser micro-fixes** — use the already-computed `li` cursor, hoist the
   single `findRtfBlocks` pass, drop the whole-file `joined` string. ~2× faster.
8. 🟡 **Raise `MAX_TOTAL_DECOMP_BYTES` to ~150 MB and report exact truncation
   counts** instead of a vague toast.

## Status — what has since been IMPLEMENTED (2026-09-22, same day)

| Rec | Status | Evidence |
|---|---|---|
| 1. Wire `chunkDocsByBytes` into the wizard | ✅ **done** | `MAX_UPLOAD_BYTES = 3 MB` in `WizardClient.tsx`; the wizard now posts N batches, merges their summaries into one review screen, and finalizes each job. Measured at the audit's own 6,600-song figure: **63.8 MB → 22 requests, max batch 2.99 MB, no song lost.** A 413 now explains itself instead of surfacing raw. |
| 2. Hoist the title set out of `bulkInsertSongs` | ✅ **done** | Replaced the unlimited `SELECT title … WHERE church_id = ?` with a batch-scoped `inArray(lower(trim(title)), <this batch's titles>)`. O(batch) instead of O(library); **~330 full-table scans removed**. Semantics unchanged — all it ever needed was "does this title exist". No call-site signature change. |
| 4. Realign the misleading caps | ✅ **done** | `MAX_BUNDLE_BYTES` / `MAX_TOTAL_BYTES` now carry comments saying plainly that they are local/server backstops, NOT achievable upload sizes, and point at the client chunker. |
| 7. Parser micro-fixes (`li` cursor) | ✅ **partly done** | The redundant per-block `for (const l of labels)` rescan is gone — section assignment was O(blocks × labels) and the linear cursor already held the answer. The double `findRtfBlocks` pass and the whole-file `joined` string are **not** yet addressed. |
| 8. Raise `MAX_TOTAL_DECOMP_BYTES` | ✅ **done** | 80 MB → **160 MB**, so a 6,600-song library (~64 MB of lyrics) is no longer sitting on the cliff. |

### Still NOT done — needs sign-off

| Rec | Why it was left |
|---|---|
| 3. Drop base64 on the dialog path | The biggest memory win, but it means moving the operator-console import dialog off Server Actions onto multipart — a behaviour change to a path churches use today. Wants its own change + field test. |
| 5. Persist import progress server-side (resume) | New schema (a batch cursor on `migrationJobs`) plus a reaper for stale `processing` rows. |
| 6. Stop storing full slides in `summaryJson` | Needs a staging table or S3 hand-off; touches the review step's contract. |
| 9. Parallelise media upload + batch the inserts | Real win, but concurrency against S3 wants its own testing. |
| 10. Rate limits on the import path | The 10/hour media limit is still incompatible with any chunked design. |

> **The bottom-line verdict at the top of this document has MOVED but not
> cleared.** The client-side gates that refused a large library are the ones
> now fixed; the 600 MB browser `arrayBuffer` ceiling in `pro-bundle-strip.ts`
> is untouched, so a ~2 GB raw export still cannot be handed to the browser in
> one piece. The documented workaround remains: export the ProPresenter library
> in parts. **Not yet verified against a real multi-thousand-song export** —
> only against the synthetic figure derived from the repo's own measurement.
