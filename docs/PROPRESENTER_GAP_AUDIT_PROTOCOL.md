# ProPresenter gap-audit protocol — MANDATORY

**Status: standing rule, user-directed 2026-09-21.**
Applies EVERY time we copy a ProPresenter feature. No exceptions.
Companion to `docs/PRODUCT_DOCTRINE.md` (ProPresenter is the base layer).

---

## The rule

> **Before and after building any ProPresenter feature, run TEN gap-audit
> subagents.** Mixed models — Opus for synthesis and judgement, Sonnet for
> breadth and enumeration. Each takes a DIFFERENT angle. If ten agents come
> back and we still do not have the cleanest possible 1:1, we have failed.

Ten shallow agents repeating each other is a failed audit. Ten agents each
owning a distinct angle, each citing primary sources, is the bar.

---

## The ten angles

Every audit assigns each agent ONE of these. Do not let two agents overlap.

1. **Official documentation sweep** — support.renewedvision.com and the
   official user guide, exhaustively, for the feature area. Quote UI wording.
2. **API / protocol truth** — the published OpenAPI spec
   (openapi.propresenter.com), the ProPresenter Control remote, and any
   community-documented protocol. Field names and types are ground truth about
   the real data model, even when the prose docs are vague.
3. **File-format / data-model archaeology** — .pro files, stage layout JSON,
   theme structures, documented field names (e.g. `oCl`, `zro`). Reveals
   options the UI hides.
4. **Video walkthroughs** — Renewed Vision's channel and reputable church-tech
   channels. Find TRANSCRIPTS and detailed written walkthroughs; an agent
   cannot watch frames, so it must say so rather than invent what a video shows.
5. **Community pain points** — forums, Reddit, Facebook groups, support
   threads. What do real operators ask for, complain about, and work around?
   This finds the DEEP features that matter in a real service.
6. **Competitor cross-check** — EasyWorship, Proclaim, OpenLP, VMix. Where a
   competitor does something better than ProPresenter, that is a chance for our
   layer to beat the standard rather than merely match it.
7. **Our-code inventory** — exhaustive: what we have, partially have, and lack,
   with file:line. Must be adversarial about "partially" — a field that is
   saved but never read is MISSING, not present. (This angle caught the AM/PM
   bug, where `period` was persisted and never used.)
8. **Silent-divergence hunt** — where we have the feature but it BEHAVES
   differently: defaults, what start/stop/reset do, rounding, edge values, what
   happens at zero, what an edit does to a running object.
9. **Customisation depth** — every property ProPresenter lets a user change,
   including through Themes, Looks and Stage layouts. Fonts, stroke, shadow,
   fill, opacity, alignment, format. Customisation is a first-class goal.
10. **Screenshot / artefact analysis** — ANY screenshots, recordings or exports
    the user has supplied, read in detail against the research. These are
    PRIMARY evidence and outrank the docs when they conflict.

---

## Rules for every agent

- **Cite a URL or a file:line for every claim.** No claim without a source.
- **Mark anything unverified as UNVERIFIED.** A fabricated feature is worse
  than a gap, because we will build it and it will be wrong.
- **Never infer a feature from a product's general reputation.** Find it, or
  say you could not.
- **Report what you could NOT check**, and why, so the gap is visible.

## Rules for the orchestrator

- Ten agents, distinct angles, spawned in parallel.
- Mix models deliberately: Opus where judgement and synthesis matter (angles
  1, 7, 8, 9), Sonnet where breadth and enumeration matter (the rest).
- **Reconcile contradictions explicitly.** When two agents disagree, go and
  check; do not average them.
- **Ask the user for screenshots** of the relevant ProPresenter screen. They
  have consistently been the highest-value evidence available and have
  corrected the documentation more than once.
- Fold the result into a spec doc (see `docs/PP7_TIMER_SPEC.md` for the shape)
  and a gap list, then build from that, not from memory.

## What an agent CANNOT do — be honest about this

- Control the user's screen, or open ProPresenter.
- Watch video frames. It can find transcripts and written walkthroughs only.
- Access anything behind a login.
When one of these is the only route to an answer, SAY SO and ask the user.

---

## Definition of done

The audit is finished when:
- every ProPresenter capability in the area is listed as have / partial / lack
- every "partial" names exactly what is missing
- every silent behavioural difference is written down
- every unverified item is labelled
- the remaining gaps are ranked by what an operator would actually feel

Anything less is a failed audit, regardless of how many agents ran.
