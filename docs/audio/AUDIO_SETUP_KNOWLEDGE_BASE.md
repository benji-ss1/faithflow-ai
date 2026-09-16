# Audio setup knowledge base (grounding for the AI audio guide) — 2026-09-15

[V] = verified with a cited source. [U] = unverified — the guide must NOT quote exact menu
paths for [U] items; give the general method and point to the desk manual.

## Golden rule for PresentFlow
Send a **dedicated post-fader FULL mix** (Main L/R, or a matrix/aux fed from Main) — it
must carry BOTH pulpit mics and the band. A speech-only feed breaks song detection.

## A. Desk → computer routing
| Desk | Method / channels the computer sees | |
|---|---|---|
| Behringer X32 / Midas M32 (X-USB) | Routing → Out 1-16: assign Main LR post-fader to e.g. Out 15/16; Routing → Card Out: pick the 8-block containing them ("Out 9-16"); computer sees 15/16. Can't send post-fader straight to the card. | [V] behringer.world/viewtopic.php?t=831 |
| Behringer Wing | USB-B direct (no hub). Routing → Outputs → USB, assign a Main to a USB pair; USB channel count (2/8/16/32/48) in Setup. | [V] Sweetwater Wing routing |
| Yamaha TF | Stereo bus → USB 33/34 by default; no macOS driver. | [V] Yamaha TF FAQ |
| Yamaha DM3/DM7/QL/CL/Rivage | Patch Stereo/Matrix to USB or Dante out in Output Patch; QL/CL/Rivage usually via Dante → DVS. | [U] |
| Allen & Heath SQ/SQ+ | USB out 1/2 = Main LR by default; change on I/O screen USB block. | [V] A&H support |
| Allen & Heath Qu | Setup → I/O Patch → USB Audio; assign Main LR to a pair (feeds Qu-Drive + USB-B 32ch). | [V] A&H Qu DAW |
| A&H CQ/dLive/Avantis | I/O patch to USB/Dante similar to SQ. | [U] |
| Soundcraft Ui24R | 32-ch USB; LR + auxes appear as USB inputs; exact LR channel unconfirmed. | [V]/[U] |
| Soundcraft Ui12/16, Si/Vi | Use analog aux/main out into an interface. | [U] |
| PreSonus StudioLive III | Universal Control: USB Send 1/2 = Main L/R → computer sees 1/2. | [V] PreSonus KB |
| Small analog (Yamaha MG, Xenyx, Mackie ProFX) | Post-fader aux (preferred) or record/tape out (-10 dBV, may be pre-fader) into interface line input. | [U] |
| Blackmagic DeckLink/UltraStudio | Install Desktop Video; Desktop Video Setup → input SDI/HDMI, audio input Embedded; needs locked video with audio. | [V] Desktop Video manual |
| Dante Virtual Soundcard | Route channels in Dante Controller; match sample rate; licence active; latency 4 ms (10 ms if dropouts). | [V] Audinate |

## B. Symptom → causes (ranked) → fix
- **Silent**: wrong device; desk not patched to USB; muted/pre-fader source; macOS mic permission denied → check desk USB meters, pick device+channel, Privacy & Security → Microphone.
- **Wrong channel**: app on 1/2, desk sends 33/34 (TF) or 15/16 (X32) → ask which pair, match it.
- **Too low**: line into mic input with low gain; -10 dBV into +4 dBu (~11.8 dB short); low pre-fader send → raise send/gain to peaks ≈ -12 dBFS.
- **Clipping**: +4 dBu line into mic input without pad; bus too hot → pad / line input / lower send.
- **50/60 Hz hum**: ground loop (unbalanced, different outlets), generator/dirty power, dimmers → balanced cables, common outlet, DI/isolator ground lift. NEVER lift power safety earth.
- **Hiss**: gain added late → gain-stage at the desk.
- **One side / phasey**: mono on L only; polarity-reversed pair cancels in mono → send L+R or mono sum, check polarity.
- **Echo/room**: using laptop built-in mic → select the desk feed.
- **Music-only / speech-only**: band-only or pulpit-only aux → post-fader Main/matrix with everything.
- **Dropouts/crackle**: USB hub, small buffer, 44.1 vs 48 kHz mismatch, Dante latency too low → direct port, 48 kHz everywhere, DVS 4→10 ms.
- **Device disappears**: USB power saving/sleep/hub/cable → direct port, disable sleep, swap cable. [U]
- **SDI embedded silent**: no video lock; wrong audio input in Desktop Video Setup → confirm video, set Embedded, test in Media Express.
- **Dante VSC silent**: not subscribed in Dante Controller; sample-rate mismatch; not licensed/started.
- **Fell back to MacBook mic**: interface unplugged/slept → re-select; app warns on device change.

## C. Levels & safety
- Peaks -18 to -12 dBFS; below -24 dBFS hurts ASR. RMS ≈ -30 to -20 [U]. SNR > 20–30 dB (each 5 dB lost ≈ +10–20% WER) [V Deepgram].
- Don't add noise reduction before ASR — it worsened accuracy in every test [V Deepgram].
- +4 dBu = 1.228 V balanced; -10 dBV = 0.316 V unbalanced; gap ≈ 11.8 dB [V].
- Line out → line input (or pad/DI); 48 V OFF on inputs fed by line/unbalanced sources; mute before patching; ground lift only on the audio path. [U general practice]

## D. Question order a pro uses
1. Mixer make/model? 2. Connection: USB, Dante, analog, SDI/capture? 3. Direct or via hub/dock?
4. Spare matrix/aux, or Main L/R? 5. Does the feed include pulpit mics AND band? 6. Post-fader?
7. Which USB/Dante channel numbers? 8. Do the desk's USB output meters move?
9. App meter: nothing / low / clipping? 10. 48 kHz on both? 11. Hum/crackle/dropouts, same power as desk?
12. (Mac) Microphone permission on?

## Gaps (second research pass before quoting menus)
Yamaha DM3/DM7/QL/CL/Rivage, A&H CQ/dLive/Avantis, Soundcraft Si/Vi/Ui12/16, Mackie DL/ProFX USB, Midas HD96.
