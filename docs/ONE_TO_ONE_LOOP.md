# The 1:1 loop — how we close ProPresenter gaps

**Standing rule, user-directed 2026-09-21.** Sits on top of
`docs/PRODUCT_DOCTRINE.md` (ProPresenter is the base layer) and
`docs/PROPRESENTER_GAP_AUDIT_PROTOCOL.md` (ten agents, ten angles).

---

## 1. Found a gap or a bug? Fix it. Now. Don't ask.

When an audit, a test or a review finds behaviour that does not match
ProPresenter, or a bug, **go straight to the root and fix it in the same
session**. Do not file it, do not list it as "still open", do not ask
permission. Reporting a bug you could have fixed is not a status update, it is
an unfinished job.

**Root, not symptom.** Ask why it was possible, not just what broke. The three
AM/PM-class bugs on timers were all the same root cause — a field saved and
never read. The fix is the chain AND a guard that makes the class impossible.

Only stop to ask when: it needs a product decision only the user can make, it
needs evidence only they can get (a screenshot, a real ProPresenter), or it is
genuinely destructive.

## 2. Loop until it is 1:1

One pass is never enough. The loop:

```
  audit (10 agents, 10 angles)
    -> fix every gap found, at the root
      -> adversarial + dynamic testing (see §3)
        -> audit again
          -> repeat until a full pass finds nothing
```

An audit that finds nothing is the exit condition. An audit that finds
something means the loop runs again. Do not declare a feature done because the
obvious work is finished; declare it done when a fresh adversarial pass comes
back empty.

## 3. Test DYNAMICALLY — attack the system, don't tick boxes

The happy path proves nothing. Testing must be creative, hostile and
unbiased — approach it as a blank canvas, as an inquisitive operator trying to
break the thing, not as its author defending it.

**Do this:**
- **Combine features that were never designed together.** Timer + scene + NDI +
  overrun + a colour trigger at 0 + reload, all at once.
- **Add, then remove, then re-add.** Create a timer, show it, delete it while
  live, recreate it with the same name. Half of all bugs live in teardown.
- **Attack the seams.** Two operators, two tabs, one church. Edit on one while
  the other runs it. Reload mid-countdown. Kill the window at 0:01.
- **Stretch every bound.** 24-hour durations, 8 triggers, 50 timers, a 200-char
  name, scale 5x on a 4:3 screen, a target clock across midnight and across a
  DST change.
- **Ask "what if we also wanted X"** — design a plausible new feature, then see
  whether the foundation could take it. Where it could not is where the
  foundation is weak.
- **Take things away.** What happens with no DB, no network, no operator, no
  name, no end time, no permission?
- **Assume nothing is wired.** Trace every field end to end. "Saved" is not
  "working" — a field nothing reads is a bug, not a feature.

**Do not** write tests that merely restate the implementation. A test that
cannot fail is worse than no test, because it buys false confidence. Every
guard should be mutation-checked: break the thing on purpose, confirm the test
screams, put it back.

## 4. Compress the work — use the agents

Fan out. Ten audit agents, plus review agents, plus destructive testers, all in
parallel, each with a distinct angle and a real brief. Then RECONCILE: when two
agents disagree, go and check rather than averaging. Agents read stale
snapshots and get things wrong — verify anything load-bearing yourself before
acting on it.

## 5. Keep it simple

1:1 with ProPresenter in CAPABILITY. Simpler than ProPresenter in USE. Never
simpler in what it can do. No speculative abstraction, no half-wired features,
no scaffolding without a consumer — dead code IS a bug, because it looks like
a feature to the next person.

Every system we build gets a UI. A capability an operator cannot reach does
not exist.
