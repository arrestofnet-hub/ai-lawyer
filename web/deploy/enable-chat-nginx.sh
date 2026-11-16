#!/usr/bin/env bash
# Expose AI Lawyer standalone chat at https://ailawyer.kz/chat/ without touching
# the existing MCP proxy, landing page, /invite/, or other services.
# Safety: preflight checks, root-only backup, nginx syntax test, live HTTP check,
# and automatic rollback if anything fails.
set -Eeuo pipefail
umask 077
CONF=/etc/nginx/sites-enabled/ai-lawyer
BACKUP="/root/ai-lawyer-nginx-before-chat-$(date +%Y%m%d-%H%M%S).conf"
ROLLBACK=0

[[ ${EUID} -eq 0 ]] || { echo 'ERROR: run as root' >&2; exit 1; }
[[ -f "$CONF" ]] || { echo "ERROR: missing $CONF" >&2; exit 1; }
command -v python3 >/dev/null || { echo 'ERROR: python3 is required' >&2; exit 1; }
nginx -t
HEALTH=$(curl -fsS --max-time 5 http://127.0.0.1:8791/chat/health) || { echo 'ERROR: pilot backend is not healthy' >&2; exit 1; }
[[ "$HEALTH" == *'"ok":true'* && "$HEALTH" == *'"configured":true'* ]] || {
  echo 'ERROR: pilot backend health is not ready' >&2; exit 1;
}
if grep -Eq '^[[:space:]]*location[[:space:]]+/chat/' "$CONF"; then
  echo 'ERROR: /chat/ already exists in nginx configuration; inspect it instead of duplicating.'
  exit 1
fi

cp -p -- "$CONF" "$BACKUP"
ROLLBACK=1
rollback() {
  if [[ "$ROLLBACK" -eq 1 ]]; then
    echo 'Restoring previous nginx configuration.' >&2
    cp -p -- "$BACKUP" "$CONF"
    nginx -t && systemctl reload nginx || true
    echo "Backup retained at $BACKUP" >&2
  fi
}
trap 'rc=$?; rollback; exit "$rc"' ERR

python3 - "$CONF" <<'PY'
from pathlib import Path
import re
import sys

conf = Path(sys.argv[1])
source = conf.read_text()
if not re.search(r'(?m)^\s*server_name\s+ailawyer\.kz(?:\s|;)', source):
    raise SystemExit("ERROR: ailawyer.kz server_name not found")
if not re.search(r'(?m)^\s*listen\s+(?:\[::\]:)?443\s+ssl', source):
    raise SystemExit("ERROR: HTTPS listener not found")

pattern = re.compile(r'(?m)^(?P<indent>[ \t]*)location[ \t]+/[ \t]*\{')
matches = list(pattern.finditer(source))
if len(matches) != 1:
    raise SystemExit(f"ERROR: expected exactly one root location, found {len(matches)}")

indent = matches[0].group('indent')
lines = [
    'location /chat/ {',
    '    proxy_pass http://127.0.0.1:8791;',
    '    proxy_set_header Host $host;',
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-Proto $scheme;',
    '    proxy_http_version 1.1;',
    '    proxy_read_timeout 135s;',
    '    client_max_body_size 8m;',
    '}',
    '',
]
block = '\n'.join(indent + line if line else '' for line in lines) + '\n'
pos = matches[0].start()
conf.write_text(source[:pos] + block + source[pos:])
PY

nginx -t
systemctl reload nginx
sleep 1
PUBLIC_HEALTH=$(curl -kfsS --max-time 8 --resolve ailawyer.kz:443:127.0.0.1 https://ailawyer.kz/chat/health)
[[ "$PUBLIC_HEALTH" == *'"ok":true'* ]] || {
  echo "ERROR: new /chat/ routing health check failed" >&2; exit 1;
}
ROLLBACK=0
trap - ERR
printf '%s\n' 'SUCCESS: https://ailawyer.kz/chat/ is routed to the private pilot backend.'
printf '%s\n' "$PUBLIC_HEALTH"
printf 'Nginx backup: %s\n' "$BACKUP"
