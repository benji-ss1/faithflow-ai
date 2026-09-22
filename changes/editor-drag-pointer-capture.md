---
headline: Fixed — a slide element could get stuck to the mouse in the slide editor
audience: operator
version: 0.1.507
date: 2026-09-22
highlights:
  - Dragging or resizing an element in the slide editor no longer gets stuck if you release the mouse outside the app window - over a menu, off the edge of the screen, or on a video. The element used to keep following the pointer until you clicked again.
  - Right-clicking an element no longer starts a drag by accident.
  - Trackpad and touch drags are now handled properly, and a drag that the system interrupts is ended cleanly instead of being left half-finished.
  - The editor now refuses to start a drag while the canvas has not been measured yet, instead of moving the element to an invalid position that was then silently thrown away when the slide was saved.
---
