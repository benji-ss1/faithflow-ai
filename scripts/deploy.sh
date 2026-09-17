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
    CREATED_APP=0
    if ! flyctl apps list 2>/dev/null | grep -q faithflow-convert; then
      flyctl apps create faithflow-convert --org personal
      CREATED_APP=1
    else
      ok "app faithflow-convert exists"
    fi

    step "3/4 — Shared secret (auth between Vercel and the converter)"
    # NEVER rotate an existing secret on redeploy — Vercel holds the matching
    # value and a silent rotation would break every PowerPoint import in prod.
    if flyctl secrets list -a faithflow-convert 2>/dev/null | grep -qE '^[[:space:]]*CONVERT_SHARED_SECRET([[:space:]]|$)'; then
      ok "CONVERT_SHARED_SECRET already set on Fly — keeping it (not regenerating)."
      echo "   To rotate deliberately: flyctl secrets set CONVERT_SHARED_SECRET=... -a faithflow-convert, then update Vercel."
    elif [ "$CREATED_APP" = "1" ] || [ -n "${CONVERT_SHARED_SECRET:-}" ]; then
      SECRET="${CONVERT_SHARED_SECRET:-}"
      if [ -z "$SECRET" ]; then
        SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        warn "First-time setup: generated CONVERT_SHARED_SECRET. Set the SAME value on Vercel:"
        echo "   CONVERT_SHARED_SECRET=$SECRET"
        echo "   CONVERT_SERVICE_URL=https://faithflow-convert.fly.dev"
      fi
      flyctl secrets set CONVERT_SHARED_SECRET="$SECRET" --stage --app faithflow-convert
    else
      warn "App exists but has no CONVERT_SHARED_SECRET (or 'flyctl secrets list' failed). Refusing to mint one silently."
      echo "   Re-run with: CONVERT_SHARED_SECRET=<the value on Vercel> ./scripts/deploy.sh convert"
      exit 1
    fi

    step "4/4 — Deploy"
    flyctl deploy --app faithflow-audio --now

    echo
    ok "Audio bridge deployed"
    URL="wss://faithflow-audio.fly.dev"
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

  convert)
    step "1/4 — Fly.io login (opens browser)"
    if ! flyctl auth whoami >/dev/null 2>&1; then
      flyctl auth login
    else
      ok "already logged in as $(flyctl auth whoami)"
    fi

    step "2/4 — Ensure app exists"
    CREATED_APP=0
    if ! flyctl apps list 2>/dev/null | grep -q faithflow-convert; then
      flyctl apps create faithflow-convert --org personal
      CREATED_APP=1
    else
      ok "app faithflow-convert exists"
    fi

    step "3/4 — Shared secret (auth between Vercel and the converter)"
    # NEVER rotate an existing secret on redeploy — Vercel holds the matching
    # value and a silent rotation would break every PowerPoint import in prod.
    if flyctl secrets list -a faithflow-convert 2>/dev/null | grep -qE '^[[:space:]]*CONVERT_SHARED_SECRET([[:space:]]|$)'; then
      ok "CONVERT_SHARED_SECRET already set on Fly — keeping it (not regenerating)."
      echo "   To rotate deliberately: flyctl secrets set CONVERT_SHARED_SECRET=... -a faithflow-convert, then update Vercel."
    elif [ "$CREATED_APP" = "1" ] || [ -n "${CONVERT_SHARED_SECRET:-}" ]; then
      # First-time setup (or an explicit value passed in the environment).
      SECRET="${CONVERT_SHARED_SECRET:-}"
      if [ -z "$SECRET" ]; then
        SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        warn "First-time setup: generated CONVERT_SHARED_SECRET. Set the SAME value on Vercel:"
        echo "   CONVERT_SHARED_SECRET=$SECRET"
        echo "   CONVERT_SERVICE_URL=https://faithflow-convert.fly.dev"
      fi
      flyctl secrets set CONVERT_SHARED_SECRET="$SECRET" --stage --app faithflow-convert
    else
      warn "App exists but has no CONVERT_SHARED_SECRET (or 'flyctl secrets list' failed). Refusing to mint one silently."
      echo "   Re-run with: CONVERT_SHARED_SECRET=<the value on Vercel> ./scripts/deploy.sh convert"
      exit 1
    fi

    step "4/4 — Deploy"
    flyctl deploy --config fly.convert.toml --app faithflow-convert --now

    echo
    ok "Converter deployed"
    echo "   Set on Vercel:  CONVERT_SERVICE_URL=https://faithflow-convert.fly.dev"
    echo "                   CONVERT_SHARED_SECRET=<unchanged unless first-time setup printed a new one>"
    ;;

  full)
    "$0" audio
    "$0" app
    ;;

  *)
    cat <<EOF
Usage: ./scripts/deploy.sh <command>

  audio    Deploy audio WebSocket bridge to Fly.io (needs flyctl login)
  convert  Deploy PPTX→PDF converter to Fly.io (needs flyctl login)
  app      Deploy Next.js app to Vercel (needs vercel login + env vars set)
  full     Deploy audio first, then app

Prereqs already installed at:
  vercel:  $HOME/.npm-global/bin/vercel
  flyctl:  $HOME/.fly/bin/flyctl

Read DEPLOY.md for env var lists and post-deploy verification.
EOF
    ;;
esac
