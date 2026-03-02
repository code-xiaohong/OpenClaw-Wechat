#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WITH_BOT_E2E=false
SELF_CHECK_ARGS=()

print_help() {
  cat <<'EOF'
OpenClaw-Wechat smoke check

Usage:
  npm run wecom:smoke -- [options]

Options:
  --with-bot-e2e        Also run Bot E2E selfcheck (signature/encryption/stream-refresh)
  -h, --help            Show this help

Other options are forwarded to:
  npm run wecom:selfcheck -- --all-accounts ...
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-bot-e2e)
      WITH_BOT_E2E=true
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      SELF_CHECK_ARGS+=("$1")
      shift
      ;;
  esac
done

TOTAL_STEPS=5
if [[ "$WITH_BOT_E2E" == "true" ]]; then
  TOTAL_STEPS=6
fi
STEP=1

echo "[$STEP/$TOTAL_STEPS] Syntax check"
npm run test:syntax
STEP=$((STEP + 1))

echo "[$STEP/$TOTAL_STEPS] Unit tests"
npm test
STEP=$((STEP + 1))

echo "[$STEP/$TOTAL_STEPS] WeCom selfcheck (all discovered accounts)"
npm run wecom:selfcheck -- --all-accounts "${SELF_CHECK_ARGS[@]}"
STEP=$((STEP + 1))

if [[ "$WITH_BOT_E2E" == "true" ]]; then
  echo "[$STEP/$TOTAL_STEPS] WeCom Bot E2E selfcheck"
  npm run wecom:bot:selfcheck --
  STEP=$((STEP + 1))
fi

echo "[$STEP/$TOTAL_STEPS] Gateway health"
openclaw gateway health
STEP=$((STEP + 1))

echo "[$STEP/$TOTAL_STEPS] OpenClaw status (summary)"
openclaw status --all | sed -n '1,120p'

echo "Smoke check completed."
