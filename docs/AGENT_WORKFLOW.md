# FaithFlow AI — Agent Workflow Standard

This is how features get built and shipped in this repo. It is the working standard, not a suggestion. Deviations should be justified in the commit message.

## The Loop

Every non-trivial change follows this loop. **A change that skips steps is not done — it's provisional.**

```
1. Plan       →  TaskCreate every deliverable + acceptance criteria
2. Build      →  Foreground work OR spawn a general-purpose agent
3. Review     →  Parallel: reviewer + security + stress agents (all 3, always)
4. Fix        →  Address every 🔴 blocker; document every 🟡 skipped
5. Re-test    →  Same criteria, same commands, prove PASS again
6. Ship       →  Commit → push → verify prod via MCP + real HTTP smoke
7. Report     →  Status block per checkpoint (see template below)
```

If any step surfaces a real gap, loop that checkpoint again. Do NOT advance to the next checkpoint until the current one re-tests clean.

---

## Agents you spawn — always

For every checkpoint that produces > 100 lines of new code OR touches auth/data/church_id/AI/output-channel logic, spawn these three sub-agents **in parallel** (all three, before you commit):

### 1. Reviewer agent
- **Purpose**: code quality, correctness, dead code, accessibility, hydration, type safety.
- **Prompt template**: see [`prompts/reviewer.md`](#reviewer-agent-prompt) below.
- **Never modifies code** — reports only.
- **Must return**: 🟢 Strong / 🟡 Concerns / 🔴 Blockers + fix priority list.

### 2. Security agent
- **Purpose**: church_id scoping, auth gating, secret leaks, RLS, XSS/injection, credential handling.
- **Prompt template**: see [`prompts/security.md`](#security-agent-prompt).
- **Never modifies code** — reports only.
- **Must return**: 🟢 Green / 🟡 Concerns / 🔴 Blockers with specific line refs.

### 3. Stress agent
- **Purpose**: acceptance-criteria coverage AND concurrent/failure/edge-case behavior.
- **Prompt template**: see [`prompts/stress.md`](#stress-agent-prompt).
- **Never modifies code** — reports only.
- **Must return**: ACCEPTANCE COVERAGE (N criteria, each PASS/PARTIAL/FAIL) + STRESS FINDINGS + go/no-go.

Spawn all three **in the same message** with `run_in_background: true`. When all three notifications arrive, apply fixes for every 🔴 blocker before the next commit.

### Optional: Passes agent
For final checkpoints (release gate, cross-phase audits), add a fourth **passes agent** that:
- Re-runs every prior acceptance criterion in one continuous session
- Refuses to soft-pass anything based on "earlier we saw it work"
- Produces the final GO / NO-GO with specific blockers

---

## Rules for what agents return

- **Every finding must be tagged** 🔴 / 🟡 / 🟢. No unranked prose.
- **Every 🔴 must be a genuine blocker** — user-visible break, data loss, security exploit, silent broken feature.
- **Every 🟡 must be actionable** — file + line + one-sentence fix.
- **Every 🟢 must be provable** — code ref or test name, not vibes.
- **No soft passes.** "Overall this looks fine" is not a valid report.

## Rules for the human-facing status block

At the end of every checkpoint, output this block verbatim (fill in fields). Not doing this means the checkpoint isn't done:

```
CHECKPOINT [N]: [name]
Build:              [what was built — bullets, not paragraphs]
Self-test:          [PASS/FAIL + evidence — command output or test name]
Reviewer:           [findings — 🔴 count / 🟡 count]
Security:           [findings — 🔴 count / 🟡 count]
Stress:             [findings + acceptance coverage]
Fixes applied:      [list, or "none needed"]
Re-test:            [PASS/FAIL + fresh evidence]
Loops required:     [count — how many build→fix→retest iterations]
Known gaps:         [honest bullets — what didn't ship and why]
```

---

## What you MUST NOT do

- **Don't hide gaps in a summary paragraph.** If reviewer flagged something and you deferred it, list it in "Known gaps."
- **Don't retroactively soften pass criteria** after seeing results. Declare thresholds *before* running.
- **Don't skip Re-test after fixes.** Every fix pass produces new bugs; the re-test is the gate.
- **Don't run only one agent** ("the reviewer looked good, ship it"). All three, always.
- **Don't summarize what agents "would have found."** Actually spawn them.

---

## Concrete pattern for spawning three agents

Do this **in a single response**, before the commit:

```
Agent(subagent_type: general-purpose, description: "Reviewer",
       prompt: <see template>, run_in_background: true)
Agent(subagent_type: general-purpose, description: "Security",
       prompt: <see template>, run_in_background: true)
Agent(subagent_type: general-purpose, description: "Stress",
       prompt: <see template>, run_in_background: true)
```

Wait for all three notifications. Apply fixes. Then commit.

---

## Reviewer agent prompt

```
You are the CODE REVIEWER for FaithFlow AI at /Users/benjisanusi/faithflow-ai.
Recent commit(s): <hash + one-line message>.

Read the diff via `git show --stat <hash>` and `git show <hash> -- <paths>`. Do NOT modify code.

Assess for:
1. Correctness — does the code do what the commit message says?
2. React best practices — hydration mismatches, useEffect deps, unused hooks, memory leaks
3. Accessibility — keyboard nav, aria-labels on icon-only buttons, focus rings
4. Loading / empty / error states — no blank screens if network fails
5. Type safety — no `any` beyond what's justified
6. Race conditions in async code (streams, timers, subscriptions)
7. Dead code / unused imports / unnecessary deps
8. Documentation — do JSDoc / comments match reality?

Return under 400 words:
- 🟢 STRONG POINTS (2-3 bullets)
- 🟡 CONCERNS (fix soon, not blocking)
- 🔴 BLOCKERS (must fix before checkpoint pass)
- Fix priority list

Be direct. Do not be nice for niceness's sake.
```

---

## Security agent prompt

```
You are the SECURITY REVIEWER for FaithFlow AI at /Users/benjisanusi/faithflow-ai.
Recent commit(s): <hash + one-line message>.

Focus areas:
1. Church-scoping — every DB write path uses requireUser() and stores church_id
2. Auth gating — new API routes call apiUser() before touching data
3. Secret handling — no service-role, no hardcoded credentials, no client-bundle leaks
4. Injection surfaces — SQL, XSS, prototype pollution, path traversal, zip bombs
5. Cross-tenant isolation — server-only helpers cannot be tricked into returning another church's data
6. Rate limiting — new endpoints rate-limited proportionally to blast radius
7. Error surface — production errors don't leak infra hostnames, table names, or stack traces
8. Third-party trust — new external calls (webhooks, MCP, LLM) validate provenance

Return under 400 words:
- 🟢 GREEN — what's genuinely safe (specific line refs)
- 🟡 CONCERNS — fix soon, not blocking demo
- 🔴 BLOCKERS — exploitable pre-demo, must fix
- Specific commands / code refs

Do NOT modify code. Report only.
```

---

## Stress agent prompt

```
You are the STRESS/PASSES agent for FaithFlow AI at /Users/benjisanusi/faithflow-ai.
Recent work built: <one-line summary + acceptance-criteria list from spec>.

For each acceptance criterion, verify by reading the code:
- Does an implementation exist?
- Is it discoverable via nav / API surface?
- Does it degrade gracefully when a dependency is missing?
- Are strings genuinely informative or generic filler?

Also do a STRESS analysis of at least 6 concrete scenarios:
1. Concurrent operators / clients on the same resource
2. Network reconnect mid-session
3. Fallback path when primary is unavailable
4. Fan-out / scaling limits (10x, 100x)
5. Session refresh / page reload state
6. Downstream disconnect (audio, DB, storage)

Do NOT modify code. Report under 500 words:
```
ACCEPTANCE COVERAGE (N criteria):
 1. <criterion> — <ships/partial/missing + evidence>
 ...

STRESS FINDINGS (6 scenarios):
 1. <scenario> — <analysis>
 ...

BLOCKERS: <list, or "none">
FOLLOW-UPS: <list>
Overall: PASS / PARTIAL / FAIL for <target readiness state>
```
```

---

## Checkpoint template for the human-visible report

Copy this into your final response for every checkpoint:

```markdown
### CHECKPOINT [N]: [name]

**Build**
- [what shipped, bullets]

**Self-test**
- [command + output + verdict]

**Reviewer agent** — [🔴 blocker count, 🟡 concern count]
- Blockers: [one-liners with file:line]
- Concerns worth calling out: [one-liners]

**Security agent** — [🔴 blocker count, 🟡 concern count]
- Blockers: [one-liners]
- Concerns: [one-liners]

**Stress agent** — [acceptance PASS/PARTIAL/FAIL, N scenarios stressed]
- Coverage: [X/Y criteria pass]
- Real gaps: [one-liners]

**Fixes applied**
- [what was changed to close the blockers]

**Re-test**
- [command + verdict — fresh run, not the pre-fix result]

**Loops required**: [count]

**Known gaps (honest, unblended)**
- [what didn't ship + reason + when it'll ship]

**Confidence**: HIGH / MEDIUM / LOW — [one-sentence justification]
```

---

## When you hit unknowns

- **Missing hardware** (real mic, projector, mixer): say so in the report. Do NOT claim tested-under-load.
- **Missing external service** (Fly not deployed yet, Groq key missing): document as a known gap; graceful degradation must be proven.
- **Missing acceptance criteria in the ask**: state them explicitly BEFORE running. Never retroactively adjust after seeing results.

## Persistence

Update this file every time the standard evolves. Every commit that touches process should reference this doc:

```
Standard update per docs/AGENT_WORKFLOW.md
```
