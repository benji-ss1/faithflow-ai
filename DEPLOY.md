# Present Flow — Deployment Runbook (JPD external review)

## Architecture reality check

PresentFlow has **two runtime components**:

1. **Next.js app** (all UI, API routes, projector surfaces, editor, analytics) — deploys to Vercel cleanly.
2. **Audio WebSocket bridge** (`scripts/audio-server.ts`) — a persistent Node WebSocket server on port 3001 that terminates browser mic streams and proxies to Deepgram. **Cannot run on Vercel** — Vercel Functions do not support long-lived WebSocket servers.

If you deploy only the Next.js app, everything works EXCEPT AI Listening (live mic → transcription). The projector, editor, themes, effects, announcements, Bible library, PPTX import, analytics, practice mode all work.

To make AI Listening work in production you need a separate long-lived host for the audio bridge (Railway, Fly.io, Render, DigitalOcean droplet). See section 4.

---

## 1. Prerequisites

```bash
# Install Vercel CLI locally (once)
npm i -g vercel

# Log in
vercel login
```

You'll need account access to:
- **Neon** (or wherever `DATABASE_URL` points) with pgvector extension enabled.
- **AWS S3 / MinIO** for media + PPTX artefacts.
- **Deepgram** for streaming STT (`DEEPGRAM_API_KEY`).
- **Groq** for AI helpers (`GROQ_API_KEY`).
- **Resend** for verification emails (`RESEND_API_KEY`).

---

## 2. Deploy the Next.js app to Vercel

```bash
cd /Users/benjisanusi/presentflow
vercel link     # attach this repo to a Vercel project
vercel --prod   # first deploy
```

Vercel will detect Next.js 15 automatically.

### 2a. Required environment variables (Production)

Set every one of these in Vercel Dashboard → Project → Settings → Environment Variables (Production scope). Local `.env.local` is not read in production.

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Postgres w/ pgvector | `postgres://...neon.tech/presentflow?sslmode=require` |
| `AUTH_SECRET` | NextAuth JWT signing | `openssl rand -base64 32` |
| `AUTH_URL` | Production URL | `https://presentflow.app` |
| `NEXT_PUBLIC_APP_URL` | Same as AUTH_URL, client-visible | `https://presentflow.app` |
| `AWS_REGION` | S3 region | `eu-west-2` |
| `AWS_ACCESS_KEY_ID` | S3 IAM user | — |
| `AWS_SECRET_ACCESS_KEY` | S3 IAM user | — |
| `S3_BUCKET` | Media + PPTX artefacts | `presentflow-media-prod` |
| `S3_ENDPOINT` | Only if using MinIO / R2 / non-AWS | leave blank for AWS S3 |
| `DEEPGRAM_API_KEY` | STT provider | `...` |
| `GROQ_API_KEY` | AI helpers (llama-3.3-70b-versatile) | `gsk_...` |
| `RESEND_API_KEY` | Email verification | `re_...` |
| `EMAIL_FROM` | Verified sender | `noreply@yourdomain.com` |
| `NEXT_PUBLIC_AUDIO_WS_URL` | wss URL of the audio bridge | `wss://audio.presentflow.ai:3001` |

**Do NOT set the audio bridge on Vercel — it won't work.** Set the URL to whatever host you use in step 4.

### 2b. Post-deploy verification

```bash
# From your local machine, hit the production URL
curl -s https://YOUR-PROD-URL/api/health
# expect: {"ok":true,"ts":...}
```

Log in and click through:
- `/dashboard`, `/services`, `/library/songs`, `/library/bible`, `/library/media` — should all render
- Create a service plan → open `/services/{id}/operate` — dark shell should load
- `/live` in a second tab, `SEND TO LIVE` in operator → projector should mirror within one frame
- All this works with **zero audio bridge** — verifies the Vercel-only surface is functional

---

## 3. Seed the demo church in production

```bash
# Point at production DB (either export in shell or edit .env.production.local)
DATABASE_URL="postgres://...prod" npx tsx --env-file=.env.production.local scripts/seed-demo.ts
```

You get:
- **Email:** `demo@jpd.presentflow.ai`
- **Password:** `JpdReview2026!`
- **Church:** JPD Demo Church (London, non-denominational, 220 seats)
- **Service plan:** "Sunday Morning · March 15 2026" — 6 items covering logo/song/scripture/prayer
- **4 songs** (Amazing Grace, How Great Thou Art, Holy Holy Holy, Great Is Thy Faithfulness — all public domain)
- **5 resolved AI suggestions** so `/analytics` shows a real trend

Idempotent — re-run any time to reset.

Also seed Bible if this is a fresh DB:
```bash
DATABASE_URL="postgres://...prod" npx tsx --env-file=.env.production.local scripts/seed-bible.ts
DATABASE_URL="postgres://...prod" npx tsx --env-file=.env.production.local scripts/embed-bible.ts
```

---

## 4. Audio bridge deployment (for AI Listening + wss://)

The audio bridge is `scripts/audio-server.ts`. It needs:
- A persistent Node process on a real host with TLS termination
- Env: `DEEPGRAM_API_KEY`, `AUTH_SECRET` (SAME value as Vercel), `DATABASE_URL`
- Port 3001 (or whatever), exposed as `wss://`

### Recommended: Fly.io (fastest to stand up)

```bash
# Install flyctl
brew install flyctl

# From the repo root
fly launch --no-deploy --name presentflow-audio
# ↑ generates fly.toml — edit to expose 3001 and set the start command
```

Add to `fly.toml`:
```toml
[processes]
  audio = "npm run ws"

[[services]]
  internal_port = 3001
  protocol = "tcp"
  [[services.ports]]
    handlers = ["tls"]
    port = 443
```

Set secrets:
```bash
fly secrets set DEEPGRAM_API_KEY=... AUTH_SECRET=SAME_AS_VERCEL DATABASE_URL=postgres://...
fly deploy
```

Fly gives you a URL like `https://presentflow-audio.fly.dev`. The wss URL becomes `wss://presentflow-audio.fly.dev` (Fly does TLS termination automatically on 443).

Now go back to Vercel → set `NEXT_PUBLIC_AUDIO_WS_URL=wss://presentflow-audio.fly.dev` and redeploy Vercel so the client bundle picks up the new URL.

### Alternative: Railway / Render / VPS
Any host that supports a persistent Node process with TLS in front (Cloudflare / Caddy / nginx). Same env vars, same `npm run ws` command.

### Verifying wss:// end-to-end

1. Open browser DevTools → Network → WS filter on the operator page.
2. Toggle AI Listening ON.
3. You should see a WebSocket connection open to your `NEXT_PUBLIC_AUDIO_WS_URL` (wss://, not ws://). Status: 101 Switching Protocols.
4. Speak — see interim transcript segments appear in the AI tab.
5. Speak "John 3:16" — a suggestion card should appear.
6. If the WS fails to open, check: (a) `NEXT_PUBLIC_AUDIO_WS_URL` set correctly in Vercel, (b) the audio bridge is running on your Fly/Railway host, (c) `AUTH_SECRET` matches on both sides (the audio bridge verifies the HMAC ticket the app mints).

---

## 5. Live URL + credentials to hand to Victor

After steps 1–3 (Next.js only — AI Listening will be disabled), you can share:

```
URL:      https://YOUR-VERCEL-DEPLOYMENT.vercel.app
Email:    demo@jpd.presentflow.ai
Password: JpdReview2026!
```

What Victor can do without the audio bridge:
- Everything except live mic → transcription
- Simulate AI detections via the "Simulate phrase" input in the operator's AI tab
- See the full editor, effects catalog, themes, announcements, analytics, practice mode
- Multi-church isolation trust artifact: run `npx tsx --env-file=.env.local test/adversarial/cross-church.test.ts` locally to show 11/11 PASS

If you complete step 4 (audio bridge on Fly/Railway), everything works end-to-end including live mic and real-time detection.

---

## 6. Vercel-specific gotchas already addressed

- `next.config.ts` marks native/heavy Node packages (`@napi-rs/canvas`, `libreoffice-convert`, `pdfjs-dist`, `@xenova/transformers`, `@deepgram/sdk`, `sharp`, `ws`, `adm-zip`) as `serverExternalPackages` so they don't blow the client bundle or crash the Function build.
- Server actions have `bodySizeLimit: 50mb` for PPTX uploads. PPTX/media large uploads use S3 pre-signed PUT — never routed through Vercel.
- **PPTX conversion** requires `soffice` (LibreOffice) which is NOT available on Vercel Functions. Either: (a) accept that PPTX imports won't convert on Vercel (upload works, conversion fails gracefully with `errorMessage: "LibreOffice not installed"`), or (b) move `POST /api/pptx/convert` to the same Fly/Railway host as the audio bridge and proxy the S3 key. Currently the pptx pipeline runs where the API route runs.

---

## 7. Rollback

Vercel keeps every previous deployment. If a demo goes sideways:
```bash
vercel rollback
```
# auto-deploy connectivity test 1784688077
