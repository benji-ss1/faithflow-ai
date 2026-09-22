---
headline: A deploy can no longer ship code the database is not ready for
audience: admin
version: 0.1.511
date: 2026-09-22
highlights:
  - Today the Timers and Stage Layouts panels showed "Background task failed" because a database change was written but never applied, and the code that needed it shipped anyway.
  - Every build now checks the live database against the code before it deploys. If the database is behind, the build stops and names exactly which tables and columns are missing — and the version already running stays up.
  - The check reads the real schema, so a new table or column is covered the moment it is written. There is no list anyone has to remember to update.
---

The check skips itself when it cannot reach a database (local checkouts, CI
without credentials) rather than blocking a build it cannot judge.
