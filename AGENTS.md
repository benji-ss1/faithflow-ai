# Four rules. Every agent, every task, every time.

Applies to **every** AI agent working on this repo — Claude, Claude Code, ChatGPT,
Codex, Cursor, anything. Read this before you touch anything. It is short on
purpose.

---

## 1. NEVER REGRESS

Doing nothing is better than breaking something that works.

Before you change a feature, find out what already exists (`git log`, the code,
`docs/MILESTONES.md`) and what currently works. Preserve it.

- Never delete, unwire or replace a working feature without explicit sign-off.
- Every change states what it could break, and you verify those paths before shipping.
- If you cannot prove no regression, **don't ship — report.**
- Anything in the locked list in `docs/MILESTONES.md` was confirmed working on real
  hardware. Treat touching those files as a regression risk and say so out loud.

## 2. DON'T OVER-ENGINEER

Build the smallest thing that actually fixes it.

- No new abstraction, service, flag or layer unless the problem genuinely needs it.
- Don't add a second way of doing something that already has a way.
- Prefer deleting a workaround over adding one on top.
- If the fix is one field or one line, it is one field or one line. Ship that.

## 3. GO STRAIGHT TO THE ROOT

Fix the cause, not the symptom.

- No `setTimeout` to make state catch up. No arbitrary delays. No extra z-index.
  No special case per content type. No forced re-render to paper over bad state.
- If you find yourself adding a sentinel value or a heuristic to guess intent,
  stop: the model is missing a state. Add the state.
- Say plainly when the real fix is bigger than the ask, then do the ask properly
  and flag the rest. Don't silently patch around it.

## 4. FACTS ONLY. NO GUESSING, NO STALE DOCS.

State what you **verified**, and say where you got it. Everything else is a
question, not a statement.

**Say the thing you actually measured.** `select count(*) from church_preferences`
returns 9 rows — that is "9 preference rows", NOT "9 churches", NOT "9 churches on
trial", NOT "9 installs". A row count is not a business fact. If you have not
checked what a number *means*, do not put a noun on it.

**Where the real numbers live** (check these, in this order):
- **Commercial truth — who is a lead / on trial / installed:** the Ops CRM,
  Supabase project `PresentflowOPS`, table `churches_pipeline`
  (`pipeline_stage`, `lifecycle_stage`, `deleted_at is null`). NOT the product DB.
- **Product usage — who actually ran a service:** product DB `PresentflowAPP`,
  `audio_sessions` (and exclude `churches.is_demo = true`, plus obvious test rows).
- **Infra:** the platform CLI/API, never a config file. `fly machines list`,
  the Vercel project API, `pg_stat_activity`.

**Never present these as the same thing:** signed up ≠ onboarded ≠ on trial ≠
installed ≠ actually using it. A church row can exist with zero services ever run.
Demo and E2E-test rows are in there too.

**Stale documents are not evidence.** If a doc, audit or memory file is more than
~2–3 weeks old and you are about to act on it, **stop and say so**:

> "`docs/X.md` was last updated on <date>. I'm about to rely on it for <decision>.
> Is it still accurate, or should I re-verify <specific thing> first?"

Then re-verify from the source before building on it. Do not follow a stale doc
just because it exists. Prompt for a better one.

**When you do not know, say "I don't know" and say how you'd find out.** An
honest gap is useful. A confident guess costs trust and gets built on.

**Never claim something is tested when you only read the code.** Anything needing
a projector, mic, camera or a real church is **unverified** until a human says
otherwise.

---

## What "done" means here

Not "looks good". Done is: the loop ran (Plan → Build → Review → Fix → Re-test →
Ship → Report), typecheck is clean, the offline suite passes, and anything that
needs a projector, mic or camera is reported as **untested** rather than claimed.

Report honestly. If a test fails, say so with the output. If you skipped a step,
say that. Never claim a thing is verified when you only read the code.

Full detail: `CLAUDE.md` (rules, build protocol) and `docs/AGENT_WORKFLOW.md`
(the loop, review-agent prompts, checkpoint template).
