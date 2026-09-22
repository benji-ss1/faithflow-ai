---
headline: Fixed — quick theme changes in the Theme panel no longer undo each other
audience: operator
version: 0.1.517
date: 2026-09-22
highlights:
  - Changing two settings quickly one after another in the Theme panel now keeps both. Each control used to save the whole theme as it looked when the panel last drew, so a second change made a moment later could quietly put the first one back.
  - Setting or clearing a theme background from the media bin now changes only the background, so it no longer wipes other theme settings at the same time.
  - Undo on a background change still puts the theme back exactly as it was.
---
