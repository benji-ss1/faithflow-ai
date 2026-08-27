# OpenFlow — full product vision (captured 2026-08-27)

The north star: OpenFlow is the church-aware creative core of PresentFlow. The
operator should be able to *create stunning services, images and slides by
talking to it*, using everything the church already has — their songs, media,
verses, themes and their own recurring patterns.

## Increment ladder
- **A1 (BUILDING NOW):** persistent OpenFlow chrome (logo/wordmark always visible),
  welcome→chat continuity (hero shrinks into the header, no hard swap), calm
  contained motion (kill the full-screen ember wipe), ambient low-opacity shader
  behind the whole panel. Pure UI, no DB.
- **A2/A3:** persistence — `openflow_conversations` + `openflow_messages`
  (church-scoped) + a conversation rail (history / New chat / rename / pin /
  delete / restore). "Back to the first screen" = New chat / wordmark click.
- **A-DND (drag & drop INTO OpenFlow):** drop a song, media asset or verse card
  from the library/playlist onto the composer → OpenFlow ingests it as context
  ("use this", "build around this", "make an image from this"). Chips show what's
  attached; removable.
- **A-THEMES:** OpenFlow can *call upon the church's themes* — reference a theme by
  name, apply it to a generated plan/slide, and use its palette/background as the
  style seed for **image generation** and the **service builder**, so generated
  output matches the church's look one-to-one.
- **A-PATTERNS:** learn/store each church's recurring pattern (typical running
  order, favourite songs, preferred themes, service shape) so OpenFlow's drafts
  feel bespoke to *that* church, not generic.
- **A-WEB:** let the operator search/scrape the web *through* OpenFlow (find a
  hymn's public-domain lyrics, a sermon illustration, an image reference) —
  grounded, cited, and never auto-storing licensed text (per CLAUDE.md rule 11 /
  Bible-translation rules).
- **A-IMAGE:** image generation mode (provider TBD) seeded by theme + church
  palette to create stunning, on-brand backgrounds/slides.

## Cross-cutting rules
- Church-scoped on every read/write (rule 5) + adversarial cross-church tests.
- Groq-only AI via the OpenFlow dedicated key (now openai/gpt-oss-120b).
- Never invent scripture/song text; ground in the church's real DB.
- All motion behind prefers-reduced-motion.
- Design language: warm-sunset gradient, cursive "Flow", open-ring mark, ambient
  shader, v2 depth + ember — NO emoji, Tabler/lucide icons only.
