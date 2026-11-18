#!/usr/bin/env bash
# Enable verified Google signups only after the Google token endpoint works.
# The server enforces encrypted HMAC IP/global quotas for new Google accounts.
set -Eeuo pipefail
umask 077
FILE=/etc/ai-lawyer-web.env
[[ "$(id -u)" == 0 ]] || { echo "ERROR: run as root"; exit 1; }
[[ -f "$FILE" ]] || { echo "ERROR: missing $FILE"; exit 1; }
[[ -r "$FILE" ]] || { echo "ERROR: cannot read config"; exit 1; }
grep -q '^GOOGLE_CLIENT_ID=' "$FILE" && grep -q '^GOOGLE_CLIENT_SECRET=' "$FILE" || {
  echo "ERROR: configure Google OAuth client ID and secret first"; exit 1;
}
[[ "$(stat -c %a "$FILE")" == "600" ]] || chmod 600 "$FILE"
backup=$(mktemp /root/.ai-lawyer-google-signup.XXXXXX)
cp -p "$FILE" "$backup"
tmp=$(mktemp /etc/.ai-lawyer-google-signup.XXXXXX)
chmod 600 "$backup" "$tmp"
changed=0
rollback(){
  if [[ "$changed" == 1 ]]; then
    cp -p "$backup" "$FILE" || true
    systemctl restart ai-lawyer-web || true
    echo "ERROR: previous OAuth settings restored" >&2
  fi
  rm -f "$tmp"
}
trap rollback ERR
awk '!/^GOOGLE_SIGNUP_ENABLED=/' "$FILE" > "$tmp"
printf '%s\n' 'GOOGLE_SIGNUP_ENABLED=1' >> "$tmp"
chmod 600 "$tmp"
changed=1
mv -f -- "$tmp" "$FILE"
systemctl restart ai-lawyer-web
sleep 2
curl -fsS --max-time 10 http://127.0.0.1:8791/chat/api/session | grep -q '"googleSignupEnabled":true'
changed=0
trap - ERR
rm -f "$backup"
echo "SUCCESS: Google registration enabled with server-side HMAC IP/global limits."
echo "Existing email accounts must still be explicitly linked after password login."
