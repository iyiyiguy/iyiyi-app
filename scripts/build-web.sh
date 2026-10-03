#!/usr/bin/env bash
# Builds the web app (app.iyiyi.xyz) into dist-app/. Public client config only.
set -euo pipefail
cd "$(dirname "$0")/.."
export EXPO_PUBLIC_SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL:-https://sqsjwcsrgcgcpxccxedp.supabase.co}"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY:-sb_publishable_dC1TtQAqZpdQWRMoLAa3-w_xCSbea1x}"
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://sqsjwcsrgcgcpxccxedp.supabase.co/functions/v1}"
export EXPO_PUBLIC_SENTRY_DSN="${EXPO_PUBLIC_SENTRY_DSN:-https://eb96181c8fd8d89f9a44ea2dec4b1277@o4512105727262720.ingest.us.sentry.io/4512105734864896}"
[ -d node_modules/expo ] || npm ci
npx expo export --platform web --output-dir dist-app
echo "Built dist-app"
