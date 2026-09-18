# Theme import / export — research, feasibility and plan

Status: **Phase 1 shipped** (branch `feat/theme-import-export`, 2026-09-18). Phases 2+
are a plan, not a commitment — the ProPresenter and EasyWorship phases both have a
**blocking unknown** that only a real sample file can close (see §4).

Research tagging: **[V]** = the source was read and states this. **[?]** = inference,
second-hand, or single weak source. Nothing here is asserted without a tag.

---

## 1. What we already have (honest inventory)

Not a greenfield. Before this work the repo already had:

| Thing | Where | State |
|---|---|---|
| `exportTheme(id)` server action | `src/lib/actions.ts` | Existed. Returned the RAW `{ name, config }` row. |
| `importTheme(json)` server action | `src/lib/actions.ts` | Existed. `requireCap("edit_library")`, `sanitizeThemeConfig`, always inserted a new row. |
| Export button + download | `ThemesManager.tsx`, `RightInspector.tsx` | Existed, wrote `.pftheme.json` / `.json`. |
| Import file picker | `ThemesManager.tsx`, `RightInspector.tsx` | Existed. |
| `sanitizeThemeConfig` (key allowlist, number clamps, URL validation, `builtinId` strip) | `src/lib/theme-config.ts` | Solid. Reused as-is. |
| `sanitizeThemeLayout` (v3 layout, prototype-pollution guard, per-object validation, 256 KB cap) | `src/lib/theme-layout.ts` | Solid. Reused as-is. |
| `cleanRenderUrl` ("one URL policy") | `src/lib/render-url.ts` | Solid. Reused as-is. |
| **ProPresenter *background* import** (`.pro7/.proBundle/.pro6/.pro5/.zip` → extract images/videos → create themes) | `ThemeImportDialog.tsx` + `import-actions.ts` | **Already shipped and working. Untouched by this work.** |
| ProPresenter *song* import | `ProPresenterImportDialog.tsx` | Already shipped. Untouched. |

**So the honest framing of Phase 1 was not "build export/import" — it was "the
feature exists; find and close what is actually broken about it."** Three real
defects were found:

1. 🔴 **Cross-church storage leak.** Theme backgrounds/logos are stored as *signed
   S3 GET URLs* whose object key is `{churchId}/{purpose}/{uuid}.{ext}`
   (`/api/media/url` mints them; `keyFromPresignedUrl` in `src/lib/s3.ts` proves the
   shape). The old `exportTheme` wrote those straight into a downloadable file — so
   an exported theme handed another church a **live, working read credential for the
   exporting church's storage**, and the importing church's theme then held a
   permanent link into a foreign bucket prefix. `cleanRenderUrl` cannot catch this:
   the URL is a perfectly valid `https:` URL.
2. 🟡 **Silent breakage.** Even inside the same church, a presign expires in 6 hours,
   so a theme exported on Saturday and re-imported on Sunday came back with a dead
   background and **no message at all** — the volunteer got a black slide.
3. 🟡 **No file identity or size bound.** The file had no format marker or version,
   so any JSON object imported "successfully", and an arbitrarily large upload was
   shipped to a server action before anything checked it.

---

## 2. Phase 1 — what shipped

New pure module `src/lib/theme-portable.ts` + hardened `exportTheme` / `importTheme`.

### The file format (v1)

```jsonc
{
  "format": "presentflow.theme",
  "version": 1,
  "exportedAt": "2026-09-18T…Z",
  "name": "Sunday Morning",
  "config": { /* ThemeConfig, with every media URL REMOVED */ },
  "media": [ { "path": "bgImageUrl", "kind": "image",
               "s3Key": "<churchId>/media/<uuid>.jpg", "fileName": "<uuid>.jpg" } ]
}
```

`name` and `config` stay at the **top level on purpose**: that is exactly the legacy
`{ name, config }` shape this app exported before, so files churches already have
still import, and new files still open in the old importer (rule 0).

### The media rule (the fix for defect 1)

A portable theme **never carries a signed URL**. On export every media reference is
replaced by its *stable object key* in the `media` manifest. On import a key is
re-signed **only if its first path segment equals the importing church's id** — the
same ownership rule `/api/media/url` already enforces. Anything else is **dropped and
reported by name**. There is no code path that writes a foreign URL into a theme.

The URL-bearing places in a theme are enumerated in exactly one function
(`themeMediaSlots`) — flat `logoUrl` / `bgImageUrl` / `bgVideoUrl`, plus the v3
layout's `slides[i].bgImageUrl` and `slides[i].objects[j].url` — so a new media field
can't be silently forgotten by export (leak) or import (dangling link).

Degrade, never mangle: a dropped background downgrades `bgType` to `solid` (the solid
colour survives, so the slide still renders), and a picture-less image/video box is
removed rather than left as a broken frame. `data:image/*` and `/marketing|/brand|/login`
static URLs belong to no church, so they travel inline.

### Security posture (all test-locked)

- 1 MB file cap, enforced **client-side before upload and server-side before parsing**.
- Unknown keys rejected (`sanitizeThemeConfig`), numbers clamped, colours regex-validated.
- Prototype pollution: `__proto__` / `constructor` / `prototype` keys are refused by
  `sanitizeThemeLayout` and never reach an allowlisted theme key.
- `javascript:`, `data:image/svg+xml`, `//host`, `file:`, and same-origin app routes
  are all rejected by `cleanRenderUrl` on the way in.
- Manifest `path` values are matched against a closed regex (`isKnownMediaPath`) so a
  hand-edited manifest cannot write to `__proto__` or anywhere outside a media slot.
- `s3Key` values are shape-validated (`isSafeS3Key`): no dot segments, no backslash,
  no absolute path, length capped. Manifest capped at 64 entries.
- Ownership uses a **segment** comparison, so a church id that is merely a *prefix* of
  another (`<id>-evil/…`) is not the owner.
- `builtinId` is stripped on every import (no `allowBuiltinId`), so an imported theme
  can never impersonate a built-in and hijack its find-or-create slot.
- Import **always inserts**; it never updates. An import cannot change the look of a
  service already built on an existing theme.
- Every read and write is `churchId`-scoped; import is `requireCap("edit_library")`.

### Tests

- `test/theme-portable.test.ts` — 66 assertions: round-trip identity, cross-church
  drop, legacy-file compatibility, hostile files (oversize, malformed, wrong format,
  future version, prototype pollution, `javascript:`/`data:`/foreign-host URLs,
  hostile manifest, 5000-entry manifest), key-safety helpers.
- `test/adversarial/theme-portable-scope.test.ts` — 35 assertions: capability gate,
  church scoping of both actions, the leak invariant exercised A→B end to end,
  smuggling attempts.
- `test/theme-portable-ui.test.ts` — 19 assertions: both surfaces cap the file size,
  surface plain-English errors, render the *server's* saved values rather than the
  untrusted file's claims, and the pre-existing ProPresenter dialog is still wired in.
- Full suite: **165/165 green**, `tsc` clean.

### What Phase 1 deliberately does NOT do

**Actual media re-hosting** (server-side copying church A's background into church B's
storage as a new `media_assets` row). That needs an S3 copy path, a size/quota policy,
a MIME re-sniff, and a licensing answer (a paid background pack is not automatically
redistributable). Phase 1 takes the honest option the brief allows — *clearly report
as missing* — and leaves re-hosting as PR 2 below.

## 2A. What the existing "ProPresenter theme import" actually does (and doesn't)

Important to state plainly, because the name oversells it. `extractThemeBackgrounds`
(`src/lib/import-actions.ts:381`) runs the shared import pipeline over the dropped
archive, takes **only the media assets it finds inside**, re-uploads each one under
`{churchId}/media/{uuid}.{ext}` and returns presigned URLs; `ThemeImportDialog` then
calls `createTheme` once per background.

So today we import **ProPresenter backgrounds, not ProPresenter themes**. Nothing
parses the `Theme` protobuf: no font, colour, text-box geometry, gradient, shadow,
stroke, transition or scripture setting crosses over — an imported "theme" is a
picture with our defaults around it. That is genuinely useful (it is the thing
churches ask for most) and it is correctly church-scoped and `edit_library`-gated,
with foreign media **re-hosted under the importing church's own prefix** — the right
pattern, and the model PR 2 should follow. But it is not theme fidelity, and §3.3
below is the gap.

---

## 3. Research — ProPresenter 7

### 3.1 What a theme actually is

- **The extension a church downloads is `.proTheme`.** Church Motion Graphics' free
  themes page says it verbatim ("It will have a `*.proTheme` file extension"),
  install = double-click. **[V]** https://www.churchmotiongraphics.com/free-propresenter-themes/
- `.pro7theme` / `.pro7themelibrary` appear in prose in the community proto repo but
  no vendor or reseller page was found using them as a user-facing download. **[?]**
- **On disk an installed theme is a FOLDER**, verified from a working third-party
  implementation: `<Theme>/Theme` (a protobuf file) + `<Theme>/Assets/*` (the images).
  **[V]** https://github.com/bussnet/propresenter7-php-lib (`doc/api/theme.md`,
  `src/ThemeFileReader.php`, which does `Document::mergeFromString` on `<folder>/Theme`).
- 🔴 **BLOCKING UNKNOWN: whether a distributed `.proTheme` file is a ZIP of that folder
  is NOT confirmed. [?]** It is the obvious inference (PP7's `.proplaylist` is ZIP64
  and `.probundle` is ZIP, both **[V]**), but no source states it and the PHP library
  has zero `.proTheme` handling. **One real sample file closes this in an afternoon.**

### 3.2 The payload

- PP7 stores documents as **protobuf**, not XML (unlike Pro6). **[V]**
  https://greyshirtguy.com/blog/pro7fileformat1/
- The theme message is `rv.data.Template.Document { ApplicationInfo; repeated Template.Slide slides }`,
  where each `Template.Slide { rv.data.Slide base_slide; string name; repeated Action actions }`. **[V]**
  (`template.proto` in https://github.com/greyshirtguy/ProPresenter7-Proto)
- **There is no `RenderVaultCollection` message** anywhere in the public proto set —
  a case-insensitive grep across all 115 protos in `Proto 19beta` returns zero hits. **[V]**
- `proApiV1Theme.proto` exists but is the *network* API shape and is far too thin for
  file import. **[V]**
- **`protobufjs` loads all 115 protos with zero errors, no codegen** (verified by
  running it). **[V]** For Vercel, pre-compile to a JSON descriptor with `pbjs` so no
  `fs` proto loading is needed at runtime.
- **jeffmikels/ProPresenter-API is network-protocol only** — it does not parse files. **[V]**
- No maintained **Python** PP7 theme parser was found (not exhaustively searched). **[?]**
  The strongest reference implementation in any language is the PHP one; note it is a
  *format reference*, and OpenLP (see EasyWorship) is **GPLv3 — reimplement from format
  knowledge, never copy code into this proprietary app.**

### 3.3 What a PP7 theme carries → how it maps to our ThemeConfig v3

All source fields below **[V]** from the `.proto` files.

| PP7 field | Our field | Fidelity |
|---|---|---|
| `Graphics.Element.bounds` (Rect) | layout `objects[].x/y/w/h` | ✅ direct (PP7 is absolute px against a canvas size → convert to our %) |
| `Graphics.Element.rotation` / `.opacity` | object rotation / opacity | ✅ if our slide-object schema carries them; else drop + warn |
| `Font { name, family, size, bold, italic }` | `fontFamily`, `fontSizePx`, `fontWeight` | ⚠️ font is a **name only** — fidelity depends on the church having it. Needs a substitution warning UX. |
| `Text.Attributes` solid fill colour | `textColor` | ✅ direct |
| `Text.Attributes` gradient / media / cut-out text fill | — | ❌ **no equivalent** → drop, warn |
| `Graphics.Fill` = Color | `bgType: "solid"` + `bgColor` | ✅ direct |
| `Graphics.Fill` = Gradient (`type`, `angle`, `ColorStop[]`) | `bgType: "gradient"` + `bgColor`/`bgColor2`/`bgAngle` | ⚠️ **lossy** — we support 2 stops and linear only. 3+ stops or RADIAL/ANGLE → take the two end stops, **warn explicitly**. |
| `Graphics.Fill` = Media (+ `Assets/`) | `bgImageUrl` / `bgVideoUrl` | ✅ but **must be re-uploaded into the importing church's own storage** (this is the existing `extractThemeBackgrounds` path) |
| `Graphics.Shadow { angle, offset, radius, colour, opacity }` | `textShadow: boolean` | ⚠️ **heavily lossy** — we have a boolean. Set true, warn that the exact shadow was simplified. |
| `Graphics.Stroke { width, colour, dash }` | — | ❌ no equivalent → drop, warn |
| `Text.VerticalAlignment` / `EdgeInsets margins` | layout object geometry | ⚠️ approximate |
| `Text.ScaleBehavior` (SCALE_FONT_DOWN/UP…) | our autofit behaviour | ⚠️ map to nearest; warn on mismatch |
| `Text.Transform` (ONE_WORD_PER_LINE…) | — | ❌ drop, warn |
| `Text.rtf_data` (CocoaRTF bytes) | slide text | ⚠️ **plain text only.** Even the mature PHP library ships an RTF→plain-text extractor and goes no further. Per-run styling is a separate project. |
| `ccli.proto` `CopyrightLayout` | our CCLI/licensing display | ⚠️ partial |
| Scripture options | — | ❓ **no Bible/scripture proto exists** (`ls \| grep -i 'bibl\|scrip'` → nothing **[V]**). PP7 appears to express scripture as ordinary theme slides + data links **[?]**, so our `scriptureShowReference` / `scriptureReferencePosition` / `scriptureTranslationVisible` have **no source fields** — they stay at our defaults. |

**Policy for everything in the ❌/⚠️ rows: drop with a named, plain-English warning in
the import report. Never silently mangle.** This is the same contract Phase 1 already
uses for missing media, and the import review screen is the place to show it.

### 3.4 Other PP7 risks

- Reverse-engineered protos **drift per PP7 version** (the repo is versioned 7.16 /
  7.16.2 / 19beta for exactly that reason). Pin one; expect breakage on PP7 updates. **[V]**
- PP7 writes **broken ZIP64 EOCD headers** — the PHP library ships a `Zip64Fixer`.
  Node's `yauzl`/`jszip` will likely need the same repair. **[V]**
- `.pro6` is a much easier target: human-readable XML with base64 blobs and RTF text
  (`RVPresentationDocument`, `RVSlideGrouping`, `RVDisplaySlide`, `RTFData`); `.pro6x`
  is a ZIP of that plus media. **[V]** https://fileinfo.com/extension/pro6x
- Redistributing purchased theme assets is the church's legal problem but **our UX
  problem** — an import review screen should not imply a licence to re-share.

---

## 4. Research — EasyWorship

- **Exported theme extension is `.ewtx`** (not `.ewsx`), and renaming it to `.zip`
  reportedly opens to reveal a `media` folder. **[?] — second-hand only.** The official
  "About Themes" article confirms only the UI actions *Export Theme File…* / *Import
  Theme File…* and that a theme = "text format, background, and layout"; it gives **no
  extension and no spec [V]**. The support forum thread that does name `.ewtx` could not
  be fetched directly (support.easyworship.com forces an OAuth redirect **[V]**).
- 🔴 **BLOCKING UNKNOWN: what is inside a `.ewtx` besides `media/` is completely
  undocumented.** Plausibly a SQLite `main.db` by analogy with `.ewsx` **[?]**. **Do not
  commit to an EasyWorship theme importer until someone hands us a real `.ewtx`.**
- Themes are typed (Song / Scripture / Presentation) and a song theme cannot be
  imported as a scripture theme. **[?]**
- Internally, themes live in a **SQLite** `Themes.db` in the profile
  (`…/Softouch/EasyWorship/Default/v6.1/Databases/Data/`), not as loose files. **[?]**,
  though the sibling `Songs.db` / `SongWords.db` at that exact path is **[V]**
  (https://easyworship.com/blog/common-easyworship-files-you-want-to-know-about).
- **No Firebird `.fdb` involvement was found anywhere.** EasyWorship 2009 and earlier
  used **Paradox** `.db` + `.MB` memo files. **[V]** (OpenLP's importer reads the Paradox
  header at offset 0x800/106/120 and pulls RTF from memo blocks.)
- **The realistic bulk path is `.ewsx` (a schedule), which is a plain ZIP containing a
  SQLite `main.db`** with `presentation` / `slide` / `element` / `resource_text` tables
  and **RTF** text. With "Pack files in schedule" enabled it also embeds the church's
  backgrounds and videos. **[V]**
  https://gitlab.com/openlp/openlp/-/raw/master/openlp/plugins/songs/lib/importers/easyworship.py
  OpenLP **bypasses ZIP CRC validation** because EW writes a non-standard ZIP — same
  class of gotcha as PP7. **[V]** (OpenLP is GPLv3: reimplement, don't copy.)
- RTF is the universal EasyWorship text container, in every format. **[V]**

---

## 5. Feasibility call

| Target | Verdict | Why |
|---|---|---|
| **Our own `.pftheme.json`** | ✅ **Done (Phase 1)** | Fully under our control. Highest value, lowest risk. |
| **EasyWorship `.ewsx` backgrounds** | 🟢 **LOW risk, do next** | ZIP + SQLite + RTF, every step verified. Pure-JS (`fflate` + `sql.js` WASM) works serverless. Delivers the thing churches actually want (their backgrounds) without any theme-format unknown. |
| **ProPresenter `.proTheme`** | 🟡 **MEDIUM — feasible, blocked on a sample** | Parsing is genuinely solved in JS (`protobufjs` loads all 115 protos). The model maps well for geometry/fonts/fills. Blocked on the container format; lossy on shadows, gradients, strokes and RTF runs; no scripture source at all; breaks on PP7 version drift. |
| **ProPresenter `.pro6` templates** | 🟡 MEDIUM-LOW | Plain XML + RTF. Easier than PP7, but serves a shrinking user base. |
| **EasyWorship `.ewtx` themes** | 🔴 **DON'T COMMIT YET** | Extension is second-hand, internals undocumented. Needs a sample before it can even be estimated. |
| **Legacy `.ews` / Paradox** | 🔴 Not worth it | Hand-rolled binary parsers for a tiny, shrinking population. |

**Recommended sequencing: get one real `.proTheme` and one real `.ewtx` from a pilot
church first.** Both blocking unknowns collapse the moment we have actual bytes, and
every estimate below is provisional until then.

---

## 6. PR breakdown (each ≤600 LOC)

| PR | Scope | LOC | Risk |
|---|---|---|---|
| **1 — SHIPPED** | Portable `.pftheme.json` v1: `theme-portable.ts`, hardened `exportTheme`/`importTheme`, both UI surfaces, 3 test files, What's New 0.1.455 | ~560 | Low — additive; legacy files still import; the pre-existing ProPresenter background dialog untouched |
| **2** | **Media re-hosting.** Server-side copy of a manifest entry into the importing church's storage + a new `media_assets` row (`churchId` on the write), size/quota cap, MIME re-sniff, licensing copy on the confirm screen. Turns "reported missing" into "actually came across". | ~350 | Medium — storage cost + licensing; needs a product call |
| **3** | **Shared import-review shell.** One screen used by every foreign-format importer: "here's what came across / here's what we dropped and why", per-item keep/skip. Refactor the existing `ThemeImportDialog` review step into it. | ~400 | Low |
| **4** | **Untrusted-archive toolkit.** Zip-slip guards, entry-count / uncompressed-size / compression-ratio caps, no-CRC-trust reader, hard timeouts, parse off the request thread. Shared by PRs 5–7. Standalone, fully unit-testable, no product surface. | ~300 | Low |
| **5** | **EasyWorship `.ewsx` backgrounds** → themes, on PRs 3+4. Read-only `sql.js`, no extensions, no ATTACH. | ~450 | Low-Medium |
| **6** | **ProPresenter `.proTheme` reader** (spike first, on a real sample): container detection, `protobufjs` + pinned JSON descriptor, `Template.Document` → our config, RTF→plain-text, every lossy field named in the review screen. **Gated on the sample.** | ~550 | Medium-High |
| **7** | **`.pro6` / `.pro6x` XML templates.** Optional, only if pilot churches ask. | ~400 | Low-Medium |

Every PR keeps the Phase 1 invariants: `church_id` on every write, `edit_library` gate,
import creates and never overwrites, foreign media re-hosted or reported (never linked),
and an adversarial test in `test/adversarial/`.

---

## 7. Open questions for the product owner

1. **Re-hosting (PR 2):** do we copy another church's background into ours on import?
   It costs storage and has a licensing edge (paid packs). Phase 1's "tell them it's
   missing" is the conservative default and is already shipped.
2. **Do we have a pilot church who can send a real `.proTheme` and `.ewtx`?** Two
   blocking unknowns close on it.
3. **Font substitution:** when a PP7 theme names a font we don't have, do we substitute
   silently, substitute with a warning, or refuse the import? (Recommendation:
   substitute + name the font in the review screen.)
