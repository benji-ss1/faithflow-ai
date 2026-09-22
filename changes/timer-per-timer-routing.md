---
headline: Each timer now chooses its own screens, and the row tells you where it is going
audience: operator
version: 0.1.505
date: 2026-09-22
highlights:
  - Every timer has its own "Shows on" row — Projector, Stage, Livestream, NDI. One timer can be a stage-only confidence clock for the preacher while another counts the congregation in on the projector.
  - The timer row now tells you where it is going. Turning a timer ON used to say only that it was live, never which screens it reached; it now reads "Shows on Projector · Stage" right under the button.
  - Switch every screen off and the panel says so in red, instead of leaving you wondering why nothing appeared.
  - This is per timer and needs no setup. The Scenes "Timer" row still works the way it did and still wins — if a Scene hides timers on a screen, they stay hidden there.
  - Fix: on the projector, the number format you chose (forced hours, leading zeros) was being dropped on the way to the screen. It now arrives.
---

Before this, a timer went to all four outputs and the only way to change that
was the Scenes layer matrix — one setting for every layer at once, which an
administrator has to switch on first. Routing is now per timer, defaults to
every screen, and lives in the Look tab of the timer you are editing.
