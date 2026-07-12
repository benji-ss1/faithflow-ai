#!/usr/bin/env bash
# PresentFlow deploy driver — walks you through the interactive login/auth
# steps you have to do yourself (browser OAuth), then runs the automatable
# pieces once you're logged in.
#
# Usage:  ./scripts/deploy.sh audio       # deploy audio bridge to Fly
#         ./scripts/deploy.sh app         # deploy Next.js to Vercel
#         ./scripts/deploy.sh full        # both in order

set -euo pipefail

export PATH="$HOME/.npm-global/bin:$HOME/.fly/bin:$PATH"

step() { echo -e "\n\033[1;36m▶ $1\033[0m"; }
warn() { echo -e "\033[1;33m⚠ $1\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $1\033[0m"; }

need() {
  command -v "$1" >/dev/null || { echo "$1 not installed"; exit 1; }
}

need vercel
need flyctl

case "${1:-help}" in

  audio)
    step "1/4 — Fly.io login (opens browser)"
    if ! flyctl auth whoami >/dev/null 2>&1; then
      flyctl auth login
    else
      ok "already logged in as $(flyctl auth whoami)"
    fi

    step "2/4 — Ensure app exists"
    if ! flyctl apps list 2>/dev/null | grep -q presentflow-audio; then
      flyctl apps create presentflow-audio --org personal
    else
      ok "app presentflow-audio exists"
    fi

    step "3/4 — Set secrets (DEEPGRAM_API_KEY + AUTH_SECRET from .env.local, DATABASE_URL = Supabase pooler)"
    DG=$(grep '^DEEPGRAM_API_KEY=' .env.local | cut -d= -f2-)
    AS=$(grep '^AUTH_SECRET='     .env.local | cut -d= -f2-)
    # DATABASE_URL is hardcoded to the Supabase pooler URL (production DB the
    # Vercel app also uses). Local .env.local points at localhost postgres,
    # which is unreachable from Fly.
    DB="postgresql://postgres.mdjdemrtykflfucggbqt:qekVmfSYjcVkC%2F3@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
    if [ -z "$DG" ] || [ -z "$AS" ]; then
      echo "Missing DEEPGRAM_API_KEY or AUTH_SECRET in .env.local"
      exit 1
    fi
    flyctl secrets set \
      DEEPGRAM_API_KEY="$DG" \
      AUTH_SECRET="$AS" \
      DATABASE_URL="$DB" \
      --stage --app presentflow-audio

    step "4/4 — Deploy"
    flyctl deploy --app presentflow-audio --now

    echo
    ok "Audio bridge deployed"
    URL="wss://presentflow-audio.fly.dev"
    echo "   URL to set in Vercel:  NEXT_PUBLIC_AUDIO_WS_URL=$URL"
    ;;

  app)
    step "1/3 — Vercel login (opens browser)"
    if ! vercel whoami >/dev/null 2>&1; then
      vercel login
    else
      ok "already logged in as $(vercel whoami 2>&1 | tail -1)"
    fi

    step "2/3 — Link project (creates if new)"
    vercel link --yes

    step "3/3 — Deploy production"
    warn "You must set every env var in Vercel dashboard BEFORE the deploy will work end-to-end."
    warn "See DEPLOY.md §2a for the full list. Minimum required:"
    warn "  DATABASE_URL, AUTH_SECRET, AUTH_URL, GROQ_API_KEY, DEEPGRAM_API_KEY,"
    warn "  AWS_* + S3_BUCKET, RESEND_API_KEY, EMAIL_FROM, NEXT_PUBLIC_AUDIO_WS_URL"
    read -p "Have you set all Vercel prod env vars? [y/N] " ok_env
    [[ "$ok_env" =~ ^[yY] ]] || { echo "Aborting"; exit 1; }

    vercel --prod

    echo
    ok "Vercel deploy complete"
    ;;

  full)
    "$0" audio
    "$0" app
    ;;

  *)
    cat <<EOF
Usage: ./scripts/deploy.sh <command>

  audio    Deploy audio WebSocket bridge to Fly.io (needs flyctl login)
  app      Deploy Next.js app to Vercel (needs vercel login + env vars set)
  full     Deploy audio first, then app

Prereqs already installed at:
  vercel:  $HOME/.npm-global/bin/vercel
  flyctl:  $HOME/.fly/bin/flyctl

Read DEPLOY.md for env var lists and post-deploy verification.
EOF
    ;;
esac
