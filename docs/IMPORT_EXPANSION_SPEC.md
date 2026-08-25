# Import Expansion Spec — songs + media from every platform

**Status:** research-backed plan (deep-research 2026-08-25, partial run — 13 claims verified 3-0; PPTX-library claims unverified due to session limit, must be validated by actually testing the libs at build time). Not yet built.
**Goal:** stop being ProPresenter-only. Import songs from every realistic worship platform, and import PowerPoint / Google Slides / Gemini / Word / PDF decks into the media library.

---

## The two architectural keys (both verified)

### KEY 1 — For SONGS: standardize on OpenLyrics, don't write N proprietary parsers
**OpenLyrics** is a free, open, publicly documented XML standard for worship songs (namespace `http://openlyrics.info/namespace/2009/song`, formal RelaxNG schemas 0.6–0.9), structured as `<properties>` + `<lyrics>` → named `<verse>` → `<lines>` with `<br/>`. **OpenLP exports to it.** So one great OpenLyrics parser + OpenSong (XML) + FreeShow (.show JSON) + ChordPro + our plain-text/CSV path covers the open ecosystem. For the CLOSED formats (EasyWorship, MediaShout, SongShow Plus) the honest, reliable path is a **guided export** ("open X → export songs → import that file here"), NOT pretending to read their proprietary databases.

### KEY 2 — For MEDIA: PDF is the universal on-ramp, and rendering happens CLIENT-SIDE
Verified constraint: **PDF→image rendering requires the native `canvas` package and does NOT work in Vercel serverless / worker threads** (`unpdf.renderPageAsImage` is Node/browser-only). But **the browser HAS canvas.** So:
- Render PDF/deck pages → PNG images **in the browser** (client-side pdf.js canvas), then upload the PNGs as media assets — sidestepping the serverless limitation entirely.
- PowerPoint, Google Slides, Gemini decks, and Word all **export to PDF in one click.** So "import your PowerPoint/Google Slides/Gemini deck" = **"export to PDF (one click), we render every page to a slide image."** Direct PDF import too.
- Text extraction (PDF via `unpdf`; PPTX/DOCX via a pure-JS OOXML lib) works serverless and can supplement — but the primary media use is **visual fidelity = each slide as an image.**

---

## Feasibility matrix (honest)

### Songs
| Format | Verdict | Approach |
|--------|---------|----------|
| ProPresenter (.pro5/6/7) | ✅ FULL (already) | existing |
| CSV / plain text | ✅ FULL (already, now chunked via A1) | existing |
| **OpenLyrics (.xml / .osz)** | ✅ FULL | XML parse — the universal target; finishes OpenLP |
| **OpenSong** | ✅ FULL | XML parse |
| **FreeShow (.show / .json)** | ✅ FULL | plain JSON (`slides→items→lines→text.value`) |
| **ChordPro (.cho/.crd/.pro)** | ✅ FULL | line-based text parse |
| Proclaim (Faithlife) | 🟡 PARTIAL→finishable | JSON (already partial) |
| **EasyWorship** | ❌ HARD | Firebird/embedded DB, vendor conversion needed. Fallback: guided export to CSV/text, or the community `ew61-export` tool. Do NOT ship a fake Firebird reader. |
| **MediaShout** | ❌ HARD | proprietary `.sc7x`; exports only Image/PDF/Text. Fallback: guided export → import the PDF/text. |
| SongShow Plus | ❌ HARD | no open export; fallback via OpenLP → OpenLyrics, or text export |

### Media / presentation decks
| Format | Verdict | Approach |
|--------|---------|----------|
| **PDF** | ✅ FULL | text via `unpdf` (serverless); **pages→images rendered CLIENT-SIDE**, uploaded as media |
| **PowerPoint .pptx** | ✅ FULL (text) / ✅ via-PDF (images) | pure-JS OOXML text extract (officeparser/pptxtojson — *verify lib at build*); for images, "export to PDF" → client render |
| **Google Slides** | ✅ via-PDF | exports to PDF/PPTX → same pipeline |
| **Gemini decks** | ✅ via-PDF | export to PDF/Slides → same pipeline |
| **Word .docx** | ✅ FULL (text) / via-PDF (pages) | OOXML text extract; pages via PDF export |
| Legacy .ppt (binary OLE) | 🟡 PARTIAL | require conversion to .pptx/PDF (guided) |

---

## Build increments (each through the six-agent gate → dummy app)

**B1 — OpenLyrics + OpenSong song parsers → FULL.** Pure XML, verified schema, no infra change. Finishes OpenLP. Highest value-to-risk. (FreeShow JSON + ChordPro can ride along or be B1b.)

**B2 — PDF media import (the big one).** Client-side page→image render (pdf.js canvas) → upload PNGs as media assets via the existing media pipeline; optional `unpdf` text sidecar. This alone delivers PowerPoint/Google/Gemini/Word "import my deck" via one-click **export-to-PDF**. Needs a client render step + wiring into the media importer; no new serverless native deps.

**B3 — PPTX/DOCX direct text extract.** Add a pure-JS OOXML lib (validate it actually installs + works on Vercel with no native deps before committing to it). Direct .pptx/.docx import without the PDF step, for text-first decks.

**B4 — Guided-export flows for the closed formats** (EasyWorship, MediaShout, SongShow Plus). Not parsers — clear in-wizard instructions + accept the exported CSV/text/PDF. Honest and reliable.

**B5 (optional) — EasyWorship deeper.** Investigate the EW6 SongsDB SQLite path / `ew61-export` community tool for a real parser. Only if B4's guided export proves insufficient.

---

## Decisions (user, 2026-08-25)
1. **Media = PICTURES (exact visual look).** Each slide → an image preserving fonts/layout/colours. Editable-text is a later add. → client-side render path (KEY 2).
2. **Closed formats = GUIDED EXPORT for now.** No fake Firebird/MediaShout parser. Revisit a real EasyWorship parser (B5) only if users push back.
3. **Priority: MEDIA / PowerPoint FIRST (B2).** This is the reported bug and the biggest visible win. Songs (B1) follow.

## Caveats
- PPTX-library claims (officeparser/pptxtojson/pptx-viewer) are UNVERIFIED (session limit) — must be validated by actually installing + running them on a real .pptx in the Vercel build before relying on them. Re-run the research after the limit resets (8:20pm Dublin) to firm these up.
- The client-side PDF render adds bundle weight (pdf.js) to the import UI — measure it; lazy-load it only on the import route.
