# Deploy + build budget (Vercel)

Why this file exists: on 2026-09-17 production could not be updated for the rest of
the day. Vercel answered every build with *"Deployment rate limited — retry in 24
hours"*. Three merged PRs (#58, #59 and the live-background fix #61) sat undeployed
while five churches were being installed that weekend. Nothing was wrong with the
code. We had simply spent the day's builds on branch previews.

**The rule: production always has builds left. Previews are the thing we ration.**

---

## 1. What spends a build

Every one of these is one deployment against the daily limit:

- a push to `main` (the production deploy — the one that must never be blocked)
- **a push to any branch that has an open PR, or any branch Vercel is watching** — this
  is the one that drains the budget, because a branch under review gets pushed many
  times in a day (review fixes, changelog renumbering, merging `main` back in)
- re-running a failed deployment
- `vercel deploy` / `vercel --prod` from a laptop (forbidden anyway, see CLAUDE.md rule 0)

A PR that goes through a 6-agent review gate can easily see 6–10 pushes. Three such
PRs in a day is 20–30 builds spent on previews that nobody opened.

## 2. Settings that protect production

Both live in the Vercel dashboard → Project → Settings:

1. **Git → Ignored Build Step.** Set it to a command that skips preview builds unless
   we ask for one. Production is never skipped:

   ```bash
   # exit 1 = build, exit 0 = skip
   if [ "$VERCEL_ENV" = "production" ]; then exit 1; fi
   if git log -1 --pretty=%B | grep -qi "\[preview\]"; then exit 1; fi
   exit 0
   ```

   With this, a preview is built **only** when the latest commit message contains
   `[preview]`. Normal review pushes cost nothing.

2. **Git → Deploy Hooks / branch tracking.** Only `main` needs to auto-deploy.

Alternative, if we stop wanting the commit-message trick: turn preview deployments
off entirely and create a preview by hand (`vercel deploy` from CI, never a laptop)
when a change actually needs looking at on a screen.

**Plan level.** The Hobby plan's daily deployment cap is what we hit. If PresentFlow
is running live services in churches, the Pro plan removes this class of incident and
is the single cheapest piece of insurance we buy. Billing is the owner's call.

## 3. When a preview IS required

CLAUDE.md rule 0(b) still stands: anything that changes what the projector shows gets
looked at on a preview, in the desktop app, before `main`. That has not been relaxed.
What changed is that we now spend a build **deliberately**:

- do the whole review cycle with **no** preview (tests, typecheck, agent gates)
- when the branch is genuinely finished, push one commit whose message contains
  `[preview]`, check it in the desktop app, then merge

One preview per PR instead of one per push.

Changes that always deserve that preview:

- anything rendering to `/live`, `/stage`, `/livestream`, NDI
- fonts, text fitting, themes, layers, transitions
- anything the churches will touch during a service

Changes that usually do not:

- docs, tests, changelog renumbering
- server-only work already covered by tests

## 4. Before merging anything on a service weekend

1. `gh api "repos/{owner}/{repo}/deployments?environment=Production&per_page=1"` —
   record the current production deployment id. That id is the rollback:
   `vercel promote <id>` (instant, no rebuild).
2. Check production is actually up to date with `main`. If older commits are sitting
   undeployed, find out why **before** adding another.
3. Merge, then confirm the new deployment reaches `success` and open the app.

**No merges or flag flips within 48 hours of a service** (PP7_REBUILD_PLAN §3).

## 5. If we are rate limited again

- Do not try to work around it from a laptop. `vercel --prod` from a laptop is how
  the OBS editor was lost on 2026-09-12.
- Merged work deploys by itself once the window resets. Enable auto-merge on the PR
  (`gh pr merge <n> --merge --auto`) and let it land when builds return.
- If something must go live sooner, upgrade the plan — that lifts the limit
  immediately — and re-run the deployment.
- Production keeps serving the last good build the whole time. A rate limit is a
  *delay*, never an outage.

## 6. Quick checklist

- [ ] Ignored Build Step configured so previews need `[preview]` in the commit message
- [ ] Only `main` auto-deploys
- [ ] Production deployment id recorded before every merge
- [ ] One preview per PR, taken when the PR is finished
- [ ] Production verified after each merge
- [ ] No merges within 48 h of a service
