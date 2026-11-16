#!/usr/bin/env bash
# Configure server-side Google OAuth or SMTP without disclosing credentials to ChatGPT.
# Usage: bash configure-auth.sh google | smtp
set -Eeuo pipefail
set +x
umask 077
FILE=/etc/ai-lawyer-web.env
[[ "$(id -u)" == 0 ]] || { echo "Use root SSH terminal." >&2; exit 1; }
[[ -f "$FILE" ]] || { echo "Missing $FILE" >&2; exit 1; }
[[ -r /dev/tty ]] || { echo "An interactive SSH terminal is required." >&2; exit 1; }
mode="${1:-}"
[[ "$mode" == google || "$mode" == smtp ]] || { echo 'Usage: bash configure-auth.sh google|smtp'; exit 2; }
tmp=$(mktemp /etc/.ai-lawyer-auth.XXXXXX)
backup=$(mktemp /root/.ai-lawyer-auth-backup.XXXXXX)
chmod 0600 "$tmp" "$backup"
cp -p -- "$FILE" "$backup"
changed=0
rollback(){
  if [[ "$changed" == 1 ]]; then
    cp -p -- "$backup" "$FILE" || true
    systemctl restart ai-lawyer-web || true
    echo "Previous authentication settings restored." >&2
  fi
  rm -f -- "$tmp"
}
trap rollback ERR
quote_env(){
  local v="${2//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '%s="%s"\n' "$1" "$v"
}
if [[ "$mode" == google ]]; then
  printf 'Google OAuth Client ID: ' > /dev/tty
  IFS= read -r id < /dev/tty
  printf 'Google OAuth Client Secret (hidden): ' > /dev/tty
  IFS= read -r -s secret < /dev/tty
  printf '\n' > /dev/tty
  [[ "$id" == *.apps.googleusercontent.com && -n "$secret" &&
      "$id" != *" "* && "$secret" != *$'\n'* ]] || { echo 'Invalid Google OAuth web client ID or secret'; exit 2; }
  awk '!/^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=/' "$FILE" > "$tmp"
  quote_env GOOGLE_CLIENT_ID "$id" >> "$tmp"
  quote_env GOOGLE_CLIENT_SECRET "$secret" >> "$tmp"
  unset secret
else
  printf 'SMTP host (e.g. smtp.provider.kz): ' > /dev/tty
  IFS= read -r host < /dev/tty
  printf 'SMTP port (587 or 465): ' > /dev/tty
  IFS= read -r port < /dev/tty
  printf 'SMTP username: ' > /dev/tty
  IFS= read -r user < /dev/tty
  printf 'SMTP From address (e.g. no-reply@ailawyer.kz): ' > /dev/tty
  IFS= read -r from < /dev/tty
  printf 'SMTP password (hidden): ' > /dev/tty
  IFS= read -r -s secret < /dev/tty
  printf '\n' > /dev/tty
  [[ -n "$host" && "$port" =~ ^(587|465)$ && "$user" == *@* &&
      "$from" == *@* && -n "$secret" && "$host" != *" "* &&
      "$secret" != *$'\n'* ]] || { echo 'Invalid SMTP server settings'; exit 2; }
  awk '!/^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM)=/' "$FILE" > "$tmp"
  quote_env SMTP_HOST "$host" >> "$tmp"
  quote_env SMTP_PORT "$port" >> "$tmp"
  quote_env SMTP_USER "$user" >> "$tmp"
  quote_env SMTP_PASS "$secret" >> "$tmp"
  quote_env SMTP_FROM "$from" >> "$tmp"
  unset secret
fi
chmod 0600 "$tmp"
changed=1
mv -f -- "$tmp" "$FILE"
systemctl restart ai-lawyer-web
sleep 2
curl -fsS --max-time 8 http://127.0.0.1:8791/chat/health | grep -q '"ok":true'
changed=0
trap - ERR
rm -f -- "$backup"
echo 'SUCCESS: authentication settings saved. No secret values printed.'
echo 'The existing AI Lawyer plugin and Nginx routes were not changed.'
