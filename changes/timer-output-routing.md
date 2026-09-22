---
headline: Choose exactly which screens each timer appears on
audience: operator
version: 0.1.505
date: 2026-09-22
highlights:
  - Every timer now has a "Shows on" row — Projector, Stage, Livestream, NDI — so one timer can be a stage-only confidence clock while another counts the congregation in on the projector.
  - The timer row tells you where it is going. Turning a timer ON used to say only that it was live, never which screens it reached; now it reads "Shows on Projector · Stage" right under the button.
  - If you switch every screen off, the panel says so in red rather than leaving you to wonder why nothing appeared.
  - Fix: on the projector, the number format you chose (forced hours, leading zeros) was being dropped on the way to the screen. It now arrives.
---

Timers already went to the screens — but to *all* of them, with no way to see
that or change it unless an administrator had switched Scenes on. Routing is now
per timer, on by default for every screen (so nothing changes for a timer you
have already set up), and it sits in the Look tab of the timer you are editing.

Scenes still works the way it did: if a scene hides timers on a screen, it stays
hidden there regardless of this setting. Neither one can force a timer on.
