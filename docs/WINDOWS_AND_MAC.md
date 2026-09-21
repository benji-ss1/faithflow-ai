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
| W1 | **HEVC `.mov` may not play on Windows.** `video/quicktime` is an allowed upload type with no codec check. Mac/iPhone exports are often HEVC, which stock Chromium cannot decode — so a Mac-uploaded background could be **silently black on a Windows projector**. Smallest fix: a `canPlayType` check at upload/preview with a clear warning; transcoding is a bigger step we may not need. | 🔴 UNVERIFIED — needs a real Windows box + a real HEVC file |
| W2 | **Windows CI audio check always `exit 0`** — a genuine native-audio regression would ship under green CI. | 🟡 |
| W3 | **Windows installer is unsigned** — SmartScreen "Run anyway" for church volunteers. Known and intentional, but a real support burden. | 🟡 |
| W4 | **Windows layout fixes are one-off patches**, not a systematic fluid layout. New UI added without copying the `data-platform=win` treatment will re-introduce cramping. Process item, not code. | 🟡 |

## Untested, honestly

Nobody has run this on a Windows laptop at 150% scaling with a projector, or
played a Mac-exported HEVC `.mov` on Windows. The design is sound in principle;
that is not the same as proven. One field session converts W1 and the DPI
question from inference into fact.
