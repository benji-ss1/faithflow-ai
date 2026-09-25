---
headline: Releases no longer fail because of an outside font server
audience: admin
version: 0.1.529
date: 2026-09-22
highlights:
  - Three releases failed in one afternoon because the build downloads typefaces from Google while it runs, and Google answered oddly. The fonts now ship inside PresentFlow, so a release cannot fail for that reason again.
  - No visual change is intended. Same typefaces, same weights — they now come from files we control instead of being fetched during every build.
  - Pages also load their text slightly sooner, because the typefaces are served from the same place as the rest of the app.
---

The underlying crash was a missing check in Next.js's font loader: an
unexpected response produced an error naming neither the font nor the cause.
Removing the network from the build path is the only fix available to us.
