---
headline: Fixed — quick theme changes no longer undo each other
audience: operator
version: 0.1.509
date: 2026-09-22
highlights:
  - Changing two theme settings quickly one after another now keeps both. Each control used to save the whole theme as it looked when the panel last drew, so a second change made a moment later could quietly put the first one back.
  - Setting or clearing a theme background from the media bin now changes only the background, so it can no longer wipe out edits someone has open in the theme editor at the same time.
  - Each theme setting is now saved on its own, and the save is done in one go on the server so two people editing the same theme cannot overwrite each other's work.
  - Undo on a background change still puts the theme back exactly as it was.
---
