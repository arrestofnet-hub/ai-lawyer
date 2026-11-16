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
rollback() {
  if [[ "$CHANGED" == 1 ]]; then
    echo 'Update failed, restoring previously working source.' >&2
    git reset --hard "$OLD_COMMIT" >/dev/null || true
    chmod -R a+rX "$APP" || true
    systemctl restart ai-lawyer-web || true
  fi
}
trap 'rollback' ERR

git fetch --depth=100 origin "$BRANCH"
CHANGED=1
git merge --ff-only FETCH_HEAD
chmod -R a+rX "$APP"
cd "$APP/web"
npm install --omit=dev --no-package-lock --ignore-scripts --no-audit --no-fund
chmod -R a+rX "$APP"
npm run check
npm test
systemctl restart ai-lawyer-web
sleep 2
curl -fsS --max-time 10 http://127.0.0.1:8791/chat/health | grep -q '"ok":true'
curl -kfsS --max-time 10 --resolve ailawyer.kz:443:127.0.0.1 https://ailawyer.kz/chat/ | grep -q 'id="attachShortcut"'
curl -kfsS --max-time 10 --resolve ailawyer.kz:443:127.0.0.1 https://ailawyer.kz/chat/app.js | grep -q 'formattedAnswer'
curl -kfsS --max-time 10 --resolve ailawyer.kz:443:127.0.0.1 https://ailawyer.kz/chat/format.js | grep -q 'parseLegalMarkdown'
CHANGED=0
trap - ERR
echo 'SUCCESS: standalone AI Lawyer updated. Existing plugin, invite page and encrypted case files left unchanged.'
echo 'Open https://ailawyer.kz/chat/ and press Ctrl+F5 if the old page is cached.'
