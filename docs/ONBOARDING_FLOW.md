# PresentFlow first-time church onboarding — spec (2026-08-28)

**Not built yet — captured verbatim-in-intent from the user's spec. This is the next epic.**

## Core principle
Onboarding must NOT feel like a software tutorial. It feels like **"We're getting your church
ready for Sunday."** By the end the operator has already done the real Sunday jobs. ~10–15 min,
optional steps clearly skippable. **Show, don't explain. Every hardware step has a TEST. Never say
"done" until PresentFlow can verify it.**

## The Magic Moment (build everything around this)
Connect projector ✓ → connect mic ✓ → "Say any Bible reference" → user says "Romans 8:1" →
transcript shows it → Bible Detection "Romans 8:1 — 96%" → click → verse slide built → **Show on
Screen** → verse appears on the church projector. That's the "oh, this is different" moment.

## 5 sections (show these, not 20 steps) — progress `● ● ● ○ ○`
1. **YOUR SCREENS** — Audience → Stage → **Test**
2. **LET PRESENTFLOW LISTEN** — Audio → live Transcript test → say a verse → show the verse (Magic Moment)
3. **OPTIONAL HARDWARE** — Video input → preview → or "Skip — we don't use this"
4. **BRING YOUR CONTENT** — Songs (import, personalized by prior platform) → Bible search → Media → Theme
5. **YOUR FIRST SERVICE** — Create service → add content → 60-second rehearsal → System check → Open Sunday Service

## Step order (locked)
0. Welcome ("Let's get your church ready for Sunday", Set Up My Church / I'll do this later)
1. Church setup — name + "coming from?" (ProPresenter/EasyWorship/Proclaim/PowerPoint/OpenLP/MediaShout/Other/first system) — drives migration personalization
2. Connect screens (Hardware→Screens; auto-detect displays; assign Audience/Stage/Other)
3. **Test audience screen** — "Show Test Screen" → big obvious PRESENTFLOW / Screen connected ✓ → Yes/No-help
4. Connect audio (Hardware→Audio; pick input; **live input meter**; "✓ We can hear you")
5. **Live transcript test** — "Say 'Welcome to PresentFlow'" → words appear → Audio working ✓
6. **Magic moment** — "Say a Bible reference" → transcript → Bible detected → projector shows verse → "That's PresentFlow."
7. Video input (Hardware→Video Input) — OPTIONAL, "Skip — we don't use this"; if setup: pick device → preview → confirm (NO cropping/keying/layers taught)
8. Import songs (personalized: "Moving from ProPresenter? Bring your songs over" / Start Fresh; drop files → "148 found, 142 ready" → import → open Amazing Grace → see verse/chorus structure)
9. Bible — teach only SEARCH / PREVIEW / SHOW-or-ADD (+ versions & sizes)
10. Media — Upload / Free / Your Library → add one → Add to Service
11. Themes — ~6 previews (Minimal/Modern/Bold/Worship/Classic/Cinematic); same content → different design; preview on Song + Bible Verse → Use This Theme
12. Create first Sunday service (playlist area; optionally show OpenFlow AI)
13. Learn main live interface — MAX 5 hotspots: Library/Service (left), Slides (centre), Live Preview (upper-right), Live Transcript, Bible/AI detection chips. Stop there — no 15 tooltips.
14. Worship / Preacher / Auto modes — contextual. Worship=songs/fast lyrics; Preacher=message/transcript/scripture; Auto="assistance, not replacement" (never "AI controls your service")
15. 60-second rehearsal (OPTIONAL, tailor short) — show welcome slide ✓ → show song ✓ → say "John 3:16" ✓ → put verse on screen ✓ → clear screen ✓
16. System check → Open Sunday Service

## DO NOT teach in onboarding
Every AI setting, advanced screen routing, **NDI/SDI**, advanced video routing, every media category,
theme editor internals, every song-edit feature, all shortcuts, every translation, advanced
playlist mgmt, transcript settings, AI confidence %, automation detail. Those surface when first needed.

## Rules
1. Show don't explain. 2. Every hardware step has a test. 3. Never "done" until verified
(signal detected → transcript generated → "Audio working ✓"). 4. Skippable features say
"Skip — we don't use this". 5. Show progress as ~5 sections, not 20 steps.

## Success = operator can say
"I know where my screens are / my projector works / PresentFlow can hear us / I watched it
transcribe me / I said a Bible reference and put it on the projector / our songs are imported /
I can search Scripture / I know where media is / I know how themes work / I created Sunday's
service / I know how to put something live."

## Build notes (to scope)
- Reuse existing surfaces: Hardware→Screens (ScreensPanel), Hardware→Audio (AudioTab), Hardware→Video
  Input (VideoInputPanel), Songs import, Bible, Media, Themes, the live operator shell, Worship/Preacher/Auto.
- The "test" verifications hook real signals: screen test = a test slide to the output window; audio =
  the input meter + a transcript token; magic moment = the real Bible-detection pipeline.
- Desktop-first (Electron). Likely a guided overlay/wizard component driving the existing panels, plus a
  first-run flag persisted per church/user. Migration personalization keyed off the "coming from" answer.
