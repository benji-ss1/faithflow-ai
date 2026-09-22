---
headline: Timers now tell you when something went wrong, instead of a scary error
audience: operator
version: 0.1.512
date: 2026-09-22
highlights:
  - If adding, saving or deleting a timer fails, you now get a plain message saying what failed and that nothing was changed — instead of "Background task failed: An error occurred in the Server Components render".
  - Before this, a failed edit closed the dialog as though it had worked, so you could believe a timer was saved when it was not.
  - If your timer list cannot load, the panel now says so and offers Try again. It used to show "No timers yet", which read as though your timers had been deleted.
  - The same fix covers the Stage Layouts panel — duplicating, renaming, assigning and deleting layouts and screens.
---

The underlying failure is still logged for us to trace, but it is no longer
shown to you mid-service in language that means nothing and suggests something
worse than what happened.
