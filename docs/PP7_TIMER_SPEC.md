# ProPresenter 7 timers — verified 1:1 spec (research 2026-09-21)
Sources: support.renewedvision.com; official OpenAPI spec (openapi.propresenter.com, mirrored pro7.9.openapi-spec.json).

## 1. Timer types (oneOf, all share `id` + `allows_overrun`)
- **Countdown**: `countdown.duration` int SECONDS. Entered H:MM:SS, auto-padded. Default type on "+".
- **Countdown to Time**: `count_down_to_time.time_of_day` int seconds + `count_down_to_time.period` enum `am|pm|24_hour`.
- **Elapsed Time**: `elapsed.start_time` int sec, `elapsed.end_time` int sec OPTIONAL ("omit to specify unlimited end time").
- **Allow Overrun** = single bool on ALL THREE. Runs past endpoint; countdowns go negative. Pairs with a distinct overrun COLOR in the Theme / stage layout (`oCl`).

## 2. Timers panel (Show Controls, bottom-right, alongside Messages/Props/Audio Bin)
- "+" in UPPER-RIGHT adds a timer (defaults Countdown). Clock-icon dropdown switches type.
- Editable name textbox (default label "Timer").
- Per row: Reset (circular arrow) "reset the clock back to the settings you have entered"; Start/Stop toggle.
- Collapse arrow -> compact row: name, reset, runtime, start/stop.
- UNVERIFIED: max count, ordering, preset library (none found).

## 3. OUTPUT / DESTINATION — the core architectural difference
**PP has NO per-timer output picker.** A Timer is an abstract VALUE SOURCE. Destinations BIND BY REFERENCE.

### 3a Stage
- Stage Editor: "More (•••) -> Stage Editor", or Screens -> Edit Layouts (Cmd/Ctrl+4).
- Stage layout objects available: your created Timers/Clocks; **System Clock** (host clock, opts: show date, 12/24h);
  **Video Countdown** (runs only while video plays; API GET /v1/timer/video_countdown); **Planning Center Live timer**;
  **Auto Advance Time**.
- MECHANISM: every such object "is still created with a text box and linked text" -> a stage timer element IS a
  TEXT BOX with Linked Text bound to a timer source. Styled like any text box.
- MULTIPLE STAGE SCREENS: each physical stage screen is assigned its OWN layout independently => different timers
  on different confidence monitors simultaneously.
- **Color Triggers**: threshold colour changes, documented example orange @1:00, yellow @0:30, red @final 0:10.
- **Conditional Visibility**: Shape tab "Visibility" checkbox conditioned on state e.g. "Video Countdown Is playing".
- UNVERIFIED: a distinct "Current Timer" auto-follow element (vs binding a specific named timer).

### 3b Audience / projector — NO timer element on a slide. 3-part model:
1. The **Timer** (value source).
2. A **Theme** — text box styled/sized for the timer (size against placeholder "5:00"). Themes -> New Theme.
3. A **Message** (Show Controls -> "+", "Edit"):
   - **"Add a Token" dropdown** -> insert live-updating timer token into message text (lightweight, non-formattable).
   - **"Linked Text" checkbox** (Text tab) -> richer binding "for more creative integration into presentations or
     Props"; exposes FORMAT CONTROLS: show hours / minutes / seconds / milliseconds, show leading zeros.
   - **Theme selector** dropdown attaches theme formatting.
   - **Dismiss options**: manual clear / automatic on expiry / "After Time Expires" (auto-dismiss N sec after zero).
4. Trigger the Message onto Audience Screens.
- UNVERIFIED: inserting a timer token directly into an ordinary SLIDE text box (docs say "presentations or Props"
  but no worked example found).

### 3c Removing from an output
- Stage: delete the linked-text object from the layout (or clear the layout assignment).
- Audience: clear the active Message from the list on the left; delete the Message definition with Delete key.
- The underlying Timer KEEPS RUNNING independently unless separately stopped. <-- key semantic

### 3d Multiple destinations simultaneously
- Inherent. One Timer id can be bound into several stage layouts AND tokenized into a Message at once, because each
  destination holds a REFERENCE, not a copy. No "exclusive output" restriction exists.

## 4. Appearance
- Font/size/colour/position inherited from the Theme text box (audience) or stage layout text box. No timer-only style panel.
- Format via Linked Text: show hours/minutes/seconds/milliseconds, leading zeros. Stage `zro` flag "removes zeroes from times";
  default display minutes:seconds.milliseconds with optional hours.
- Overrun: distinct overrun colour (`oCl`) separate from running colour.
- UNVERIFIED: exact negative display convention ("-0:01"?); blink/flash (none documented).

## 5. Control & automation
- Timers panel start/stop/reset. Macros (grouped actions, nestable, triggerable from slide or Show Controls).
- Slide/cue Actions can change Stage layout, scoped "Stage Only" or "Stage + Audience".
- **ProPresenter Control** (LAN web remote): dedicated Timers section - start/stop/reset per timer, expand for detail,
  modify duration, toggle overrun. Layout fixed/non-customisable as of 7.9.1.
- **REST API** (verified field-by-field):
  GET /v1/timers ; POST /v1/timers ; GET /v1/timers/current -> {id,time,is_active} for every timer ;
  GET /v1/timers/{start|stop|reset} (ALL timers) ; GET|PUT /v1/timer/{id} ; GET /v1/timer/{id}/{start|stop|reset} ;
  GET /v1/timer/system_time (unix sec) ; GET /v1/timer/video_countdown -> formatted "00:00:01.00".
- UNVERIFIED: exact Macro action wording for timers; timer-specific hotkeys (none found).

## 6. Other
- System Clock (separate from the 3 timer types). Video Countdown (built-in, video-playback tied).
- UNVERIFIED: timezone override (appears to use host OS clock).

## USER DECISIONS 2026-09-21
- Build TRUE 1:1 (Stage Layout Editor + Themes + linked text/tokens).
- FIX the networked transport in this build (timers must reach cross-device + LAN OBS).
- INCLUDE NDI as a real target (net-new timer rendering on /ndi).
