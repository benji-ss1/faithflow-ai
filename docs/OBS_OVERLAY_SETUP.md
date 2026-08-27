# OBS lyrics over camera — Sunday setup & dry-run

Put your song words and scripture **over your live camera** in OBS — no capture card, no
extra hardware. There are **two ways** to do it; pick the one that matches where your camera is.

> **Do the 5-minute dry-run (bottom of this page) BEFORE the service.** That is how you
> "verify on site." Don't wait until people are in the room.

---

## Which path? (pick one)

**Path A — camera in PresentFlow (simplest, recommended for one computer).**
You pick the camera in **Video Input**; PresentFlow puts the camera *behind* your lyrics and
sends the combined picture to its output window. OBS just captures that window. No links, no codes.
1. In the operator, open **Video Input**, choose your camera, set **Overlay = Full**, and **Activate**.
2. In OBS: **Sources → + → macOS Screen Capture** (or **Window Capture**) → choose the
   **PresentFlow output window**.
3. Done — camera and lyrics are already combined. (Tip: in the Video Input panel, expand
   **"Stream this to OBS?"** for these steps in-app.)

**Path B — camera in OBS (camera stays in OBS; PresentFlow sends only the words).**
Use this if OBS already has your camera, or the lyrics run on a **different computer**. Two options:
- **Same computer (no code):** Operator → **Hardware → Screens** → set a screen's role to
  **Livestream** with **OBS mode**, spawn it, and add that window in OBS above your camera.
- **Different computer (browser link):** follow the **Browser Source** steps below.

---

## Path B (different computer) — Browser Source setup (~2 minutes)

**1. Get the overlay link from PresentFlow**
   - In the operator, click **Sync devices** (top bar). It creates a short **sync code**.
   - Click **Copy OBS URL**. (It looks like
     `https://faithflow-ai.vercel.app/livestream?bg=transparent&pair=XXXXXX`.)

**2. Add it to OBS**
   - In OBS, under **Sources**, click **+** → **Browser**.
   - Name it "Lyrics", click OK.
   - **URL:** paste the copied link.
   - **Width 1920, Height 1080.**
   - Tick **Shutdown source when not visible** = OFF (leave it running).
   - Click **OK**.

**3. Layer it correctly**
   - In the Sources list, **drag "Lyrics" ABOVE your Camera source** (higher = on top).
   - The lyrics now float over the camera; everywhere there's no text is see-through.

That's it. Whatever you project in PresentFlow now appears over the camera on the stream,
and follows every slide change automatically.

---

## 5-minute DRY-RUN (do this before the service)

Run through this with the camera on and OBS open, watching the **Program/preview**:

- [ ] **Words appear over camera.** Project a song slide in PresentFlow → the words show over the
      live camera in OBS, background see-through (you still see the camera behind the text).
- [ ] **Readable over your actual background.** Look at the words over your real stage/wall. If the
      white text is hard to read on a bright wall, note it — see Troubleshooting.
- [ ] **Clearing works.** Press clear/blank in PresentFlow → the words disappear and the camera is
      completely clean (no black box, no leftover text).
- [ ] **Next / previous.** Advance to the next slide and go back a slide → the overlay follows both
      directions with no lag.
- [ ] **Long verse fits.** Project a long scripture verse → it fits on screen and the reference
      (e.g. "John 3:16") shows at the bottom.
- [ ] **A non-text slide doesn't cover the camera.** If you show a logo/holding slide or an
      announcement image in PresentFlow, the overlay should NOT turn into a black rectangle over the
      camera. (Text slides are what this overlay is for; media belongs on its own OBS scene.)
- [ ] **Two PCs?** If OBS is on a different computer than PresentFlow, confirm the words still update
      when you change slides. If they don't, both machines must be on the same network and the sync
      code must be active (see Troubleshooting).

If all boxes tick, you're ready.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **Nothing shows / words don't update** | The sync code must be active in PresentFlow (Sync devices shows a code). If OBS is on a second PC, both must be on the same network. Right-click the OBS "Lyrics" source → **Refresh** / **Interact** to reload. Re-copy the OBS URL (a new code invalidates the old link). |
| **Black box over the camera** | The overlay only keys text through. If you see black, you're probably showing a media/image/video slide — put that on a separate OBS scene, or just show text slides on the overlay. |
| **White text hard to read on a bright wall** | The words carry a dark shadow, but a very bright background can still wash them out. In PresentFlow, give the scripture/song a slightly darker theme, or frame the camera so text sits over a darker area. |
| **Text too small / too big** | Set the OBS Browser source to **1920×1080** and size the source to fill the canvas. Use PresentFlow's text-size control if needed. |
| **Lyrics lag behind the slide** | Usually network. Keep both machines on a wired/strong connection. On a single PC it's instant. |

---

## Good to know
- The overlay is **view-only** — it can never change or push anything in PresentFlow; it just mirrors
  what's already on your projector. Safe to hand the link to the livestream team.
- The link is tied to your **sync code**, which expires after a few hours and can be **revoked** any
  time (Sync devices → Revoke). Mint a fresh one before each service.
- Nothing here changes your projector output — this is an *additional* feed for the stream only.
- **Rolling back:** this feature is a self-contained addition; if anything ever misbehaves, the rest
  of PresentFlow is unaffected, and the change can be reverted in one step without touching your data.

---

*Native NDI output (for vMix/TriCaster or multi-machine NDI networks) is a separate, later upgrade —
see `docs/NDI_VIDEO_OUTPUT.md`. For this Sunday, the Browser Source above is the way.*
