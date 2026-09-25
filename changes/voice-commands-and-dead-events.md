---
headline: Custom voice commands for Next and Previous verse actually work now
audience: operator
version: 0.1.537
date: 2026-09-25
highlights:
  - If you set up a custom voice phrase for "Next verse" or "Previous verse", it did nothing — and then told you it had worked. The phrase was firing into thin air while a confirmation appeared on screen. Both now move the verse.
  - A custom voice phrase set to "Kill live" no longer clears your stage screens. It clears the words. A misheard word should never take the band's timer and next lines off their monitor mid-sermon — Escape and the clear buttons are still the deliberate "everything off".
  - Blank (B) deliberately leaves stage screens alone. Blanking the congregation's screen during prayer should not take the drummer's monitor with it.
---

Also found and written down, not yet fixed: the AI "Fill announce tab" button
reports success while its text never reaches the announcement tab, and the
Projection Zone editor has no way to open it. Both are now caught by a check
that fails the build if any internal message has a sender but no receiver, or
the other way round.
