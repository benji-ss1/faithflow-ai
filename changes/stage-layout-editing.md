---
headline: Tap a stage design to use it, or build your own by dragging
audience: operator
version: 0.1.528
date: 2026-09-22
highlights:
  - Fix: the text Size slider now changes what you see while designing. It only ever changed the real stage screen, so you set a size, saw nothing move, and found out on the confidence monitor.
  - Fix: the built-in timer layouts advertised an amber-to-red countdown that never actually happened. Timer colours come from the timer itself, set in the Timers panel, and now every screen agrees.
  - "Show the name" above a timer or clock on a stage layout now works, and so does CAPITALS. Both were switchable in the data and reached no screen.
  - Tap any stage layout to put it straight on your stage screen. The one that is live is marked "On stage". Before, you had to create a "stage screen" first and then find the layout in a dropdown.
  - New layout starts you from a blank screen. Previously the only way to make your own was to copy one of the built-in ones.
  - Designing is now drag-and-drop: move a box with your finger or mouse, drag the orange corner to resize, or nudge with the arrow keys. It is the screen itself, not a list of numbers.
  - Timers and stage layouts now talk to each other. A timer tells you which stage layouts it appears in, and says when one of them is live. Tap it to jump straight there.
  - If a layout has a timer box but you have not made any timers yet, it now tells you, instead of quietly showing a dash on the stage screen.
---

Deliberately kept much simpler than the slide editor: select, move, resize.
No rotation, no layers, no alignment tools. Setting up a confidence monitor
should take a minute, not a training session.
