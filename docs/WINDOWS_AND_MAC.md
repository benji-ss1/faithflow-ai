# macOS and Windows parity

Audited 2026-09-21. **Most of the obvious gaps are already closed** — this
codebase has had real Windows work done. What follows is what is actually left.

## Already handled (do not re-investigate)

- **Keyboard**: shortcuts across `src/components/operator/**` check
  `(e.metaKey || e.ctrlKey)`, not Mac-only. `src/lib/pp7-clear.ts` documents
  that macOS hijacks F1 for brightness and adds a Cmd/Ctrl+Shift+C fallback.
- **Windows UI polish**: `globals.css` has a `html[data-platform=win]` block
  disabling animated backgrounds, `backdrop-filter` and hover-lift, and fixing
  scrollbar-width layout. Components carry Windows-only responsive collapse.
- **Electron**: `main.ts` branches accelerators, tray icon, window clamping and
  AGC; `OutputWindow.ts` handles single vs multi-display fullscreen.
- **Fonts**: `fonts/registry.ts` has Windows-safe fallback chains and always
  terminates in a CSS generic family. No macOS-only faces.
- **`-webkit-` prefixes**: a false lead. Both platforms run the same Chromium
  inside Electron, so these render identically.
- **DPI**: the slide canvas uses container-query units (`cqh`/`cqw`) and now
  `text-fit.ts` scale-to-fit, both resolution-independent by construction.
- **CI**: a real `release-windows.yml` builds an NSIS installer with the native
  NDI/Blackmagic addons.

## Open

| # | Issue | Severity |
|---|---|---|
| W1 | **HEVC `.mov` silently black on Windows.** | ✅ **FIXED 2026-09-21.** `src/lib/video-codec.ts` reads the first 64KB and detects `hvc1`/`hev1`/`hvcC`; the upload wizard warns, naming Windows and the fix (re-export H.264). The warning fires **even on a Mac that can play it** — the point is the other machine, so a local capability check would stay silent for exactly the person most likely to upload HEVC. Playback failure now reports to the OPERATOR via `media-failure.ts` while the projector still hides it (test-locked: output pages have no listener). Deduped so a looping video can't spam mid-service. | Still needs a real Windows field test to confirm the underlying decode behaviour |
| W2 | **Windows CI audio check always `exit 0`** — a genuine native-audio regression would ship under green CI. | 🟡 |
| W3 | **Windows installer is unsigned** — SmartScreen "Run anyway" for church volunteers. Known and intentional, but a real support burden. | 🟡 |
| W4 | **Windows layout fixes are one-off patches**, not a systematic fluid layout. New UI added without copying the `data-platform=win` treatment will re-introduce cramping. Process item, not code. | 🟡 |

## Fixed 2026-09-21

- **W1 HEVC** — see above. `test/windows-media.test.ts` (12 checks).
- Media failures are no longer silent: the operator is told, the audience screen
  never is.

## Untested, honestly

Nobody has run this on a Windows laptop at 150% scaling with a projector, or
played a Mac-exported HEVC `.mov` on Windows. The design is sound in principle;
that is not the same as proven. One field session converts W1 and the DPI
question from inference into fact.
