# Present Flow — Phase 1 (Manual Presentation Engine)

Browser-based church presentation platform. Phase 1 is the **reliability foundation** — fully manual, zero AI, zero network dependency during a live service.

Built on the SimplifyOSV2 standard (Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Drizzle ORM, Auth.js v5, S3).

## What's included in Phase 1

- **Service playlists** — create ordered service plans with drag-reorder
- **Item types** — song, scripture (paste-in), media (image/video), sermon (PPTX slides), blank, logo
- **Songs library** — CRUD + per-slide lyrics editor
- **Media library** — upload images/videos to S3
- **PPTX import** — server-side LibreOffice conversion → per-page PNGs
- **Operator console** — Preview / Live split with visually unmistakable panes, drag-independent
  - Big orange **SEND TO LIVE** button
  - Instant **BLANK / LOGO / KILL** quick buttons (always available)
  - Keyboard: `Space`/`→` next, `←` prev, `Enter` send, `B` blank, `L` logo, `Esc` kill
  - `Auto-send` toggle for advanced mode
- **/live page** — public, unauthenticated projector output that listens on `BroadcastChannel` (no network in the sync path)
- **Settings** — blank screen color

## Prerequisites

1. **Node.js 20+** and **npm**
2. **PostgreSQL** — local instance or Neon/Supabase URL
3. **S3-compatible storage** — real S3, MinIO, R2, or Supabase Storage S3 API
4. **LibreOffice** (only if you use PPTX import) — install `soffice`:
   - macOS: `brew install --cask libreoffice`
   - Ubuntu: `sudo apt-get install libreoffice`

## Setup

```bash
cd presentflow
npm install
cp .env.local.example .env.local
# Edit .env.local: set DATABASE_URL, AUTH_SECRET, S3_* vars
openssl rand -base64 32   # use for AUTH_SECRET
npm run db:push           # create tables
npm run db:seed           # create demo church + operator + Amazing Grace + sample plan
npm run dev
```

Open http://localhost:3000. Log in:
- Email: `operator@demo.church`
- Password: `operator123`

## How to run a service

1. Go to **Services** → click a plan → click **Operate** (or press it from the dashboard).
2. In the operator console, click **Open projector window** (top-right). A new browser window opens `/live`.
3. Drag the projector window to your second display and press <kbd>F</kbd> to fullscreen (or use OS controls).
4. In the operator window: use the playlist rail (left) to jump to items, keyboard `→`/`←` to move through slides in preview, `Enter` (or click **SEND TO LIVE**) to push preview onto the projector.
5. At any moment, click **BLANK** or hit `B` to instantly go dark. `L` for logo. `Esc` to clear live entirely.

## Reliability principles

- Once the plan is loaded into the operator console, no server round-trips happen during a service. All state lives in the browser.
- `/live` and the operator communicate via `BroadcastChannel` — same origin, no network.
- If the operator window closes, `/live` keeps its last frame and shows a small "Operator disconnected" indicator (never goes blank on its own).
- If S3 media fails to load, the slide renders empty rather than crashing.

## Scripts

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run db:push` — sync schema to DB
- `npm run db:seed` — insert demo data
- `npm run db:studio` — Drizzle Studio

## What Phase 1 does NOT do

- No AI (Groq/Gemini/anything) — Phase 2+
- No Bible database — scripture is paste-in only
- No song search / CCLI — songs are manually entered
- No multi-user collaboration
- No live PPT playback / animations — static image slides only
- No dark mode toggle — light only
