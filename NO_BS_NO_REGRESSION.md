# NO BS, NO REGRESSION

**The standard for every piece of work on PresentFlow — and on anything else we build.**

User-directed, 2026-09-22, after a session in which a guess shipped a regression twice.

---

## The rule

> **Never guess. Never assume. Work only from sources and plain facts.**
>
> **If you guess or assume, you have already regressed and failed us** — no matter how good the output looks.

This applies to **everything**: new features, existing features, building on top of a feature,
sideways changes, refactors, one-line fixes, big rewrites. Small changes are not exempt.
A small change made on an assumption is still a regression waiting for a Sunday service.

---

## What counts as a SOURCE

Ranked. Prefer the highest rank available. If you only have a low rank, say so out loud.

1. **Executed code.** You ran it and read the real output — a test, a script, a render, a query.
2. **Live data.** The production database, the real deployment, the actual file on disk.
3. **The code itself, read at a specific `file:line`**, quoted.
4. **A test that pins the behaviour.** Tests encode decisions you cannot see from the code.
5. **Primary documentation** for a third party (vendor docs, a published schema, a real `.proto`).
6. **A first-hand field report** — what the operator actually saw, in their words.

## What is NOT a source

- What the code "probably" does.
- What a similar file does, so this one must too.
- A subagent's conclusion you did not verify. **A subagent is not an authority.**
- Documentation older than the code. Check the date and the git log.
- Your own earlier statement in the same conversation. Re-verify it.
- A pattern that "always works this way".
- Anything you would have to preface with *I think*, *presumably*, *it should*, or *likely*.

---

## Before you write a line of code

1. **Reproduce it.** If you cannot reproduce it, you cannot claim to have fixed it.
2. **Find the root cause and quote it** — `file:line` plus the expression. "Around here somewhere" is a guess.
3. **Check what is already true.** Read the DB, run the test, check the live deployment.
   The system is usually less broken and more defended than it looks.
4. **Check the branch is current.** Work written against stale code is written against fiction.
5. **Name what the change could break**, and check those paths specifically.

## Before you say it is fixed

- [ ] The root cause is stated as `file:line`, not a description.
- [ ] A test fails **without** the fix and passes **with** it. If you did not check both, you do not know the test works.
- [ ] The full suite is green — and any test that broke was understood, not "updated until it passed".
- [ ] You can name what would visually or behaviourally change for a church on Sunday.
- [ ] Anything you could not verify is written down as unverified. Explicitly.

---

## Tests are decisions, not obstacles

When a test fails after your change, the default assumption is that **you are wrong and the test is right**.
A failing test is frequently a past decision you did not know about.

Read the test. Understand what it was protecting. Only change it when you can state what
the original decision was and why it no longer applies — and say so in the commit.

Two real examples from the session that produced this file:

- A reviewer suggested passing `allowBuiltinId: true`. It looked correct and fixed a real duplicate-theme
  bug. It also silently broke a deliberate security property (only one function may persist `builtinId`,
  so a user theme can never impersonate a built-in). `builtin-themes.test.ts` caught it.
- A fix promoted an untagged scripture text box to the verse frame. It also looked correct.
  `theme-decor.test.ts` caught it: the repo had deliberately decided an untagged box is *decoration*.

Both were caught by tests, not by review. Neither was sloppy work. **That is the point** —
plausible reasoning is exactly what produces these.

---

## Say what you do not know

Unverifiable is a legitimate answer. Pretending is not.

- Missing hardware (mic, projector, mixer, touchscreen): **document as untestable. Do not claim tested.**
- Missing service (no DB URL, Fly down, no API key): document as a known gap; prove graceful degradation.
- Cannot reproduce: say so, and say what you would need.

If you catch yourself writing a confident sentence you have not verified — stop and verify it,
or mark it. "I could not check this" costs a sentence. A wrong claim costs a service.

---

## Correct yourself immediately and plainly

If you said something earlier that turns out to be wrong, say so in one line and move on.
No burying it, no quietly changing course. The user is making decisions on what you told them.

---

## The floor this sits on

This does not replace the rules in `CLAUDE.md` — it is how you are expected to follow them.
Rule 0 (NEVER REGRESS) is the outcome; this file is the method.

**Doing nothing is better than regressing.**
**Reporting honestly is better than shipping a guess.**
