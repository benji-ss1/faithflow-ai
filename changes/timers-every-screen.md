---
headline: Timers now look the same on every screen
audience: operator
version: 0.1.496
date: 2026-09-21
highlights:
  - A timer now appears on the NDI feed. It never did before — NDI was the one output that ignored timers completely.
  - Where you put a timer is now respected on the stage display and the livestream, not just the projector. Before, those two always forced it into a corner whatever you chose.
  - Timers over an hour now read 1:30:00 on the screens instead of 90:00, matching what you see in the Timers panel.
  - A paused timer now says so on every screen. Only the stage display used to show that, so a stopped timer could look like it was still running on the projector.
  - Colour changes you set on a timer now reach every screen.
  - Fixed: renaming a running timer, or changing its colour, no longer rewinds it. Only a change to its duration or type resets it now.
  - Fixed: a countdown to a time of day now respects AM and PM. Setting 1:00 PM previously counted down to 1:00 in the morning.
---
