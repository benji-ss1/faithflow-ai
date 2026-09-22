---
headline: A network blip no longer throws away a service that is already running
audience: operator
version: 0.1.506
date: 2026-09-22
highlights:
  - If the internet drops mid-service, the desktop app now leaves your console exactly where it is. It used to fall back to the loading screen and start reconnecting — losing your loaded slides and your place in the service, to recover from a blip the app had not even noticed.
  - A real crash still recovers the way it always did.
  - Approving a verse and the "show verse" voice command now work with no internet, as long as that translation has been downloaded. They were quietly going to the server every time and failing, even though the whole Bible was already saved on the machine.
  - The app stops re-checking your song library every 90 seconds while offline, so the logs stay clean and the machine is left alone.
---

None of this makes the app start up without internet — that is the next piece
of work. This is about what happens when the connection goes *after* you are
already running, which is both more common and, until now, worse.
