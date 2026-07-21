#!/usr/bin/env bash
# Prompts for the hosted Supabase/S3 credentials and writes .env.local directly.
# Values are typed locally and never printed back or sent anywhere else.
set -euo pipefail

ENV_FILE="$(dirname "$0")/../.env.local"
TMP_FILE="$(mktemp)"

read -rp "Supabase DATABASE_URL (pooler connection string, Transaction mode): " DATABASE_URL
read -rp "AWS_REGION (e.g. eu-west-1): " AWS_REGION
read -rp "AWS_ACCESS_KEY_ID (Supabase S3 access key): " AWS_ACCESS_KEY_ID
read -rsp "AWS_SECRET_ACCESS_KEY (Supabase S3 secret key): " AWS_SECRET_ACCESS_KEY
echo
read -rp "S3_BUCKET (e.g. Presentflow-media): " S3_BUCKET
read -rp "S3_ENDPOINT (Supabase storage S3 endpoint URL): " S3_ENDPOINT
read -rsp "AUTH_SECRET (same value as Vercel + Fly audio bridge): " AUTH_SECRET
echo
read -rp "DEEPGRAM_API_KEY (leave blank to keep existing/none): " DEEPGRAM_API_KEY
read -rp "GROQ_API_KEY (leave blank to keep existing/none): " GROQ_API_KEY
read -rp "NEXT_PUBLIC_AUDIO_WS_URL (e.g. wss://faithflow-audio.fly.dev): " AUDIO_WS_URL

# Preserve any existing lines not being replaced (e.g. EMAIL_FROM, RESEND_API_KEY)
if [ -f "$ENV_FILE" ]; then
  grep -vE '^(DATABASE_URL|AUTH_URL|AWS_REGION|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|S3_BUCKET|S3_ENDPOINT|AUTH_SECRET|DEEPGRAM_API_KEY|GROQ_API_KEY|NEXT_PUBLIC_AUDIO_WS_URL|NEXT_PUBLIC_APP_URL)=' "$ENV_FILE" > "$TMP_FILE" || true
fi

{
  cat "$TMP_FILE"
  echo "DATABASE_URL=$DATABASE_URL"
  echo "AUTH_URL=http://localhost:3000"
  echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
  echo "AWS_REGION=$AWS_REGION"
  echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"
  echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
  echo "S3_BUCKET=$S3_BUCKET"
  echo "S3_ENDPOINT=$S3_ENDPOINT"
  echo "AUTH_SECRET=$AUTH_SECRET"
  [ -n "$DEEPGRAM_API_KEY" ] && echo "DEEPGRAM_API_KEY=$DEEPGRAM_API_KEY"
  [ -n "$GROQ_API_KEY" ] && echo "GROQ_API_KEY=$GROQ_API_KEY"
  [ -n "$AUDIO_WS_URL" ] && echo "NEXT_PUBLIC_AUDIO_WS_URL=$AUDIO_WS_URL"
} > "$ENV_FILE"

rm -f "$TMP_FILE"
echo "Wrote $ENV_FILE — pointing at hosted Supabase/S3 instead of localhost."
