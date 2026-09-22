# Product doctrine — ProPresenter is the base layer

**Status: standing principle. Read this before designing ANY feature.**
User-directed, 2026-09-21. This is not a one-off instruction for the timers
work; it is how every feature in PresentFlow is judged from here on.

---

## The one-line version

**ProPresenter is the standard. We copy it 1:1 as our BASE LAYER. Our
difference is the NEW layer we add on top: AI, efficiency, and modern UI.**

We are not competing with ProPresenter on whether a feature exists. We assume
it should exist, and that it should work the way ProPresenter works, because
ProPresenter is the reference for quality, design and functionality in this
category. We compete on the layer above.

---

## What this means in practice

### 1. ProPresenter parity is the floor, not the ceiling
If ProPresenter does something and we don't, that is a GAP — not a scoping
decision, not a "nice to have", not something to defer because our version is
simpler. Close it. An operator moving from ProPresenter to PresentFlow must
never hit a wall where the thing they have always done is missing.

### 2. Copy the DEEP features, not just the headline ones
This is the part most easily got wrong. It is not enough to ship "timers" and
call it parity. ProPresenter's depth is the product:
- Allows Overrun as a per-timer choice
- Countdown to Time with AM / PM / 24-hour
- Elapsed with an OPTIONAL end time ("omit for unlimited")
- Colour Triggers at arbitrary thresholds
- A separate overrun colour
- Format options: show hours / minutes / seconds / milliseconds, leading zeros
- Layouts as named, thumbnailed, duplicable presets
- Per-screen assignment, multiple screens, live switching

The depth IS the feature. Shipping the shallow version and moving on is how we
end up with something that demos well and fails in a real service.

### 3. Customisation and preferences are a first-class goal
Churches are not identical and operators have strong preferences. Where we can
reasonably expose a choice, expose it. Sensible defaults, then let people
change things. "We decided for you" is a last resort, not a design style.
This is an explicit, ongoing direction: KEEP ADDING preferences and
customisation, not just features.

### 4. Where ProPresenter's default conflicts with ours, ProPresenter wins
If matching ProPresenter changes existing PresentFlow behaviour, **let it
change** (user-directed, 2026-09-21, re: `allows_overrun`). Do not preserve a
PresentFlow-ism just because it shipped first. The goal is to BE the standard,
not to protect our historical accidents.

This is the one place this doctrine is allowed to override the instinct behind
rule 0 (never regress). The distinction:
- **Changing a DEFAULT to match ProPresenter: allowed.** Say so plainly in the
  changelog so operators are not surprised.
- **Breaking or removing a working feature: still forbidden.** Rule 0 stands.
  Parity is a reason to CHANGE behaviour deliberately, never a licence to ship
  something broken or to skip verification.

### 5. Our layer — where we actually differentiate
- **AI**: live detection of scripture and songs, auto-advance, voice control,
  sermon search. ProPresenter has none of this.
- **Efficiency**: fewer clicks for the same outcome. ProPresenter's capability
  with less friction. Preset-first instead of blank-canvas-first. Direct
  manipulation instead of nested modals. Never at the cost of capability.
- **Modern UI**: it should look and feel current.

Simplification is welcome ONLY where it costs no capability. If "simpler" means
"can't do that any more", it is not simpler, it is worse. When in doubt: keep
the power, hide the complexity behind a good default.

---

## How to use this doctrine

**Before building a feature**, research what ProPresenter actually does —
primary sources (support.renewedvision.com, the official guide, their published
API), not memory or assumption. Record findings and mark anything unverified.
See `docs/PP7_TIMER_SPEC.md` for the format: verified facts, cited, with gaps
flagged honestly.

**When designing**, ask in order:
1. What does ProPresenter do here, in full, including the depth?
2. Are we matching it? If not, why not — and is that a real reason?
3. What can we add on our layer (AI / efficiency / UI)?
4. What should be a preference rather than a decision we make for them?

**When reviewing**, "this is simpler than ProPresenter" is not automatically
praise. Ask what capability it gave up.

---

## Related

- `docs/PP7_TIMER_SPEC.md` — verified ProPresenter 7 timer spec
- `docs/PP7_TIMERS_PLAN.md` — the phased timers/stage-layout plan + decisions
- `docs/PROPRESENTER_FEATURE_BIBLE.md`, `docs/PROPRESENTER_MVP_SPEC.md`
- `CLAUDE.md` — rule 0 (never regress) and the build loop
