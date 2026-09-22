# ProPresenter → PresentFlow: import format reference

Status: **verified against a real export** (Kings Court, "Sept 20.proPlaylist",
7 songs, exported from ProPresenter 7 on Windows) on 2026-09-22.

This document records what ProPresenter actually emits, what PresentFlow
handles today, and what is still open. It is deliberately evidence-based —
every "verified" claim below was proven by running the real file through the
real pipeline, not inferred from the format docs.

---

## 1. The container formats

ProPresenter exports several archives. **All of them are plain ZIPs** holding
`.pro` documents plus a protobuf manifest named `data`.

| Extension | What it is | PresentFlow status |
|---|---|---|
| `.pro` | A single presentation (PP7, binary protobuf) | ✅ supported |
| `.pro6` / `.pro5` | Legacy presentation (XML, base64 RTF) | ✅ supported |
| `.proBundle` | Presentation + its media | ✅ supported |
| `.proPlaylist` | A **service/playlist** export — many songs at once | ✅ supported (added 2026-09-22) |
| `.prolib` / `.proLibrary` | A whole library export | ✅ accepted as a container |
| `.protheme` / `.proThemeBundle` | Theme export | ⚠️ container expands; theme fidelity unproven |
| `.pro7` / `.pro7x` | Seen in the wild as aliases | ✅ accepted |

### Verified anatomy of a `.proPlaylist`

```
Sept 20.proPlaylist          (ZIP)
├── Another one no dey o.pro (PP7 protobuf presentation)
├── Dependable Jesus.pro
├── Halle intro.pro
├── … 4 more .pro files
├── Media/                   (empty — media NOT embedded in this export)
├── PDF/                     (empty)
└── data                     (protobuf playlist manifest)
```

The `data` manifest carries the playlist name ("Sept 20"), a UUID per item,
and the **original Windows absolute path** of each presentation, e.g.
`C:\Users\…\Libraries\Default\Halle intro.pro` plus the relative
`Libraries/Default/Halle intro.pro`. That gives us playlist ORDER and the
source library — currently unused (see "Open work" below).

> **Note:** `Media/` was empty in this export. A `.proPlaylist` does **not**
> reliably embed backgrounds — the operator must export a `.proBundle` (or
> copy the media folder) to bring artwork across. Worth saying in the UI.

---

## 2. How the text is actually stored (the important part)

Inside a `.pro`, each slide's lyrics are an **RTF blob** inside the protobuf.

Two things that surprised us and are worth locking in memory:

1. **The real files emit `{\rtf0`, not `{\rtf1`.** Our fixtures had all been
   written with `rtf1`. The parser searches for the prefix `{\rtf`, so it
   matches both — but any new fixture or regex MUST NOT assume `rtf1`.
2. **Lines within one slide are separated by `\par\pard\li0…`**, not by
   separate text runs. Collapsing whitespace destroys the song's line
   layout — see the line-break fix below.

Example of a real slide blob (truncated):

```
{\rtf0\ansi\ansicpg1252{\fonttbl\f0\fnil CooperBlack;}…
\fs200 …No one meets you and remains the same
\par\pard\li0… Burdens are lifted in encounter with you
\par\pard\li0… Oh-oh-oh-oh-oh}
```

Non-English content round-trips correctly — the Igbo and Yoruba lines in the
Kings Court set ("Sogi ne che ndum o", "Ope mi koito", "Agbanwa") parsed
intact, which matters for our base (see CLAUDE.md rule 9).

---

## 3. What was broken, and the fix (2026-09-22)

**Symptom:** a real `.proPlaylist` imported **zero** songs, silently.

**Root cause:** *not* the parsers. The container gate in
`expandProBundles` (`src/lib/importers/pipeline.ts`) only unzipped
`.proBundle` and `.zip`. A `.proPlaylist` therefore fell straight through to
the per-file parsers, matched none of them, and produced an empty report with
no warning. **The exact same bytes renamed to `.zip` imported all 7 songs
perfectly** — that experiment is what isolated the bug.

**Fixes:**

1. `PRO_CONTAINER_RX` in `src/lib/importers/pipeline.ts` now covers every
   ProPresenter ZIP container, and the folder-prefix strip uses the same regex.
2. `normalizeSlideText()` in `src/lib/pro7-parser.ts` replaced three
   `.replace(/\s+/g, " ")` calls that were flattening `\par` newlines into
   spaces. It now collapses only *horizontal* whitespace and keeps line
   breaks — matching what the `.pro6` path already emitted, so downstream
   consumers are unchanged.
3. Accept lists / drop-zone `accept` attributes extended in
   `ProPresenterImportDialog.tsx`, `ThemeImportDialog.tsx`, `SongsBrowser.tsx`.

**Regression cover:** `test/propresenter-playlist-import.test.ts` (8 tests) —
container expansion, end-to-end import, manifest not leaking in as a song,
line-break fidelity, sibling containers, an explicit *"`.proBundle` and `.zip`
still work"* no-regression case, plus malformed and empty archives.

Fixtures are **synthetic protobuf built in-process** — CLAUDE.md rule 11
forbids committing real worship lyrics to the repo.

---

## 4. Other ways to get ProPresenter content in (researched, not yet built)

Ranked by value-to-effort for our churches:

1. **Playlist order + service structure.** We already receive the `data`
   manifest but discard it. Parsing it would let a `.proPlaylist` import as an
   actual PresentFlow *service plan* in the right order, not just seven loose
   songs. Highest value; self-contained.
2. **Media that ProPresenter did NOT embed.** Because `Media/` can be empty,
   offer a follow-up "point us at your ProPresenter Media folder" step and
   match on the filenames we already extract as `mediaHints`.
3. **The ProPresenter 7 network/API.** PP7 exposes a local HTTP + WebSocket
   remote-control API (opt-in in Preferences → Network). It can enumerate the
   library, playlists and slides live. This would enable a "connect to the PP7
   machine on the same LAN and pull everything" migration with no manual
   export at all — by far the nicest onboarding, but it needs PP7 running and
   is version-sensitive.
4. **Whole-library folder import.** Let the user pick their
   `…/Libraries/Default/` directory; we already parse every `.pro` inside.
5. **`.protheme` fidelity.** Containers now expand, but how faithfully we turn
   a ProPresenter theme into a PresentFlow theme is **unverified** — see below.

---

## 5. Open / unverified — do not claim these work

- **Theme fidelity.** `.protheme` expands as a container, but no real theme
  export has been tested end to end. Fonts (the real files reference
  `CooperBlack`, `ArialMT`) are *named* in the RTF but the font files are not
  embedded, so exact visual match cannot be guaranteed.
- **Playlist order** is parsed by nobody yet (item 1 above).
- **Arrangements.** `reorderPro7ByArrangement` handles PP7 arrangements, but
  the Kings Court files did not exercise a custom arrangement.
- **Pre-existing unrelated bug:** `stripRtf` mishandles an escaped backslash
  (`a\{b\}c\\d` → `a{b}cd`, losing the `\d`). It fails in
  `test/propresenter-import.test.ts` **both before and after** this work — it
  is not a regression from it, and was left alone deliberately.
