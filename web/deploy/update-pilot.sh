#!/usr/bin/env bash
# Upgrade only the standalone AI Lawyer pilot source. Protect user data and MCP.
# Old app commit is automatically restored if tests or local health checks fail.
set -Eeuo pipefail
umask 077
APP=/opt/ai-lawyer-web
BRANCH=feature/standalone-legal-web-v1
[[ "$(id -u)" == 0 ]] || { echo 'ERROR: run from root shell' >&2; exit 1; }
[[ -d "$APP/.git" ]] || { echo 'ERROR: pilot repository not installed' >&2; exit 1; }
cd "$APP"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || {
  echo 'ERROR: unexpected branch, refusing to update' >&2; exit 1;
}
[[ "$(git remote get-url origin)" == 'https://github.com/arrestofnet-hub/ai-lawyer.git' ]] || {
  echo 'ERROR: unexpected repository origin' >&2; exit 1;
}
[[ -z "$(git status --porcelain)" ]] || {
  echo 'ERROR: source repository has local changes; stop to avoid overwriting' >&2; exit 1;
}
OLD_COMMIT=$(git rev-parse HEAD)
CHANGED=0
STEP='preparing'
CHECK_FILE=$(mktemp /tmp/ai-lawyer-update-check.XXXXXX)
cleanup() { rm -f "$CHECK_FILE"; }
trap cleanup EXIT
rollback() {
  local status=$?
  echo "ERROR: update failed at step: $STEP (exit status $status)." >&2
  if [[ "$CHANGED" == 1 ]]; then
    echo 'Restoring previously working source and restarting the previous service.' >&2
    git -C "$APP" reset --hard "$OLD_COMMIT" >/dev/null || true
    chmod -R a+rX "$APP" || true
    systemctl restart ai-lawyer-web || true
  fi
  echo 'For diagnosis: systemctl status ai-lawyer-web --no-pager -l' >&2
}
trap rollback ERR

STEP='fetch GitHub branch'
git fetch --depth=100 origin "$BRANCH"
CHANGED=1
STEP='fast-forward source'
git merge --ff-only FETCH_HEAD
chmod -R a+rX "$APP"
cd "$APP/web"
STEP='install dependencies'
npm install --omit=dev --no-package-lock --ignore-scripts --no-audit --no-fund
chmod -R a+rX "$APP"
STEP='syntax checks'
npm run check
STEP='unit tests'
npm test
STEP='restart ai-lawyer-web service'
systemctl restart ai-lawyer-web

# Never pipe curl into grep -q with pipefail: grep can close the pipe after
# an early match, causing curl to exit 23 and triggering a false rollback.
# Read the whole response into a private temporary file before searching it.
check_response() {
  local url="$1" expected="$2" local_proxy="${3:-}"
  : > "$CHECK_FILE"
  if [[ "$local_proxy" == local_https ]]; then
    curl -kfsS --retry 5 --retry-delay 1 --retry-connrefused --max-time 10 \
      --resolve ailawyer.kz:443:127.0.0.1 "$url" -o "$CHECK_FILE" || return 1
  else
    curl -fsS --retry 5 --retry-delay 1 --retry-connrefused --max-time 10 \
      "$url" -o "$CHECK_FILE" || return 1
  fi
  if ! grep -Fq -- "$expected" "$CHECK_FILE"; then
    echo "ERROR: expected response marker missing at $STEP." >&2
    return 1
  fi
}
STEP='local server health'
check_response 'http://127.0.0.1:8791/chat/health' '"ok":true'
STEP='Nginx chat HTML'
check_response 'https://ailawyer.kz/chat/' 'id="attachShortcut"' local_https
STEP='Nginx chat JavaScript'
check_response 'https://ailawyer.kz/chat/app.js' 'formattedAnswer' local_https
STEP='Nginx formatting module'
check_response 'https://ailawyer.kz/chat/format.js' 'parseLegalMarkdown' local_https
CHANGED=0
trap - ERR
echo 'SUCCESS: standalone AI Lawyer updated. Existing plugin, invite page and encrypted case files left unchanged.'
echo 'Open https://ailawyer.kz/chat/ and press Ctrl+F5 if the old page is cached.'
