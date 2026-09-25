---
headline: Stage layouts now actually reach the stage screen
audience: operator
version: 0.1.536
date: 2026-09-25
highlights:
  - Designed stage layouts never reached the screen at all. The operator app was sending them and the stage screen was listening, but the two were passing different shapes, so every layout silently became nothing. If you designed one and saw no change, that was why — it was not you.
  - The networked timer feed had exactly the same fault, so timers never left the operator's machine either.
  - Turning off Words for a screen in a Scene now works with a layout assigned. The built-in Pre-Service scene hides the words on stage, and a layout showed them anyway.
  - The screens dashboard now shows a stage tile exactly as the monitor shows it, with live timers, and hiding what your Scene hides. It was showing timers you had switched off.
  - When several stage screens have layouts, the dashboard says so instead of quietly showing only the first.
---

The layout, the per-screen list and the timer feed are also now part of what
the stage screen checks for changes — without that, removing a layout or
assigning a new one could be skipped over and the monitor kept showing the old
one.
