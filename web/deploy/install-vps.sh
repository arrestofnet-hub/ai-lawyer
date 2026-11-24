#!/usr/bin/env bash
# AI Lawyer Kazakhstan — isolated VPS pilot bootstrap.
# Run from a root shell on the intended Ubuntu VPS AFTER reviewing this file.
# This script does not edit nginx, DNS, existing MCP service or /invite/.
set -Eeuo pipefail
umask 077

APP_DIR=/opt/ai-lawyer-web
ENV_FILE=/etc/ai-lawyer-web.env
SERVICE_FILE=/etc/systemd/system/ai-lawyer-web.service
REPO=https://github.com/arrestofnet-hub/ai-lawyer.git
BRANCH=feature/standalone-legal-web-v1

die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "${EUID}" -eq 0 ]] || die "Run as root (sudo bash install-vps.sh)."
for cmd in node git openssl systemctl curl; do command -v "$cmd" >/dev/null || die "Install missing dependency: $cmd"; done
major=$(node -p "Number(process.versions.node.split('.')[0])")
(( major >= 20 )) || die "Node.js 20+ required. Installed: $(node -v)"
[[ -r /dev/tty ]] || die "A terminal is needed to enter the API key privately."
[[ ! -e "$APP_DIR" ]] || die "$APP_DIR already exists; refuse to overwrite an installation."
[[ ! -e "$ENV_FILE" ]] || die "$ENV_FILE already exists; refuse to overwrite secret settings."
[[ ! -e "$SERVICE_FILE" ]] || die "$SERVICE_FILE already exists; refuse to overwrite a system service."
[[ ! -e /var/lib/ai-lawyer-web/database.enc ]] || die "Existing case data detected; refuse to overwrite."

printf '%s\n' "AI Lawyer VPS pilot: new isolated service on 127.0.0.1:8791."
printf '%s\n' "The existing MCP and Nginx configurations will NOT be modified."
printf 'Enter your OpenAI API key (hidden, not logged): ' >/dev/tty
IFS= read -r -s API_KEY </dev/tty
printf '\n' >/dev/tty
[[ "$API_KEY" == sk-* && "$API_KEY" != *" "* && "$API_KEY" != *$'\n'* ]] || die "Expected a secret API key beginning with sk- (without spaces)."
DATA_KEY=$(openssl rand -hex 32)
INVITE=$(openssl rand -hex 12)

git clone --depth=1 --single-branch --branch "$BRANCH" "$REPO" "$APP_DIR"
cd "$APP_DIR/web"
npm run check
npm test

# The app runs as a sandboxed DynamicUser, not root. The installer uses umask 077
# for secrets, so make public repository source files readable to the service.
# All secrets and client data remain outside APP_DIR in protected paths.
chmod -R a+rX "$APP_DIR"

# Settings accessible only to root; key never enters the repository or terminal history.
{
  printf 'NODE_ENV=production\n'
  printf 'HOST=127.0.0.1\nPORT=8791\n'
  printf 'DATA_DIR=/var/lib/ai-lawyer-web\n'
  printf 'PUBLIC_ORIGIN=https://ailawyer.kz\n'
  printf 'OPENAI_MODEL=gpt-6.1-sol\n'
  printf 'ENABLE_LAW_SEARCH=1\nSECOND_PASS_ENABLED=1\nMAX_MESSAGES_PER_DAY=20\n'
  printf 'DATA_KEY=%s\n' "$DATA_KEY"
  printf 'SIGNUP_INVITE_CODE=%s\n' "$INVITE"
  printf 'OPENAI_API_KEY=%s\n' "$API_KEY"
} > "$ENV_FILE"
chmod 0600 "$ENV_FILE"
unset API_KEY DATA_KEY
install -m 0644 "$APP_DIR/web/deploy/ai-lawyer-web.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable --now ai-lawyer-web
sleep 2
if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8791/chat/health; then
  printf '\nCheck logs: journalctl -u ai-lawyer-web -n 80 --no-pager\n' >&2
  die "Service did not pass the local health test."
fi
printf '\n\nInstalled on this VPS. The service is local-only pending Nginx /chat/ routing.\n'
printf 'Private registration invite code (store safely): %s\n' "$INVITE"
printf 'Existing plugin and public pages were not changed.\n'
printf 'Send only the NONSECRET health output to ChatGPT for the next step.\n'
