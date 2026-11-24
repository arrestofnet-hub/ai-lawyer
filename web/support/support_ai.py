"""Test-only AI phrasing of approved public FAQ. No raw mail is sent."""
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from support_faq import RU, KK

# Conservative reservations, not the provider's actual invoice or a KZT guarantee.
# At most 60 attempts/month, no retries; 3 attempts/day. One attempt reserves $0.02.
MONTH_CAP = 60
DAY_CAP = 3
MODEL = "gpt-6.1-sol"

def reserve_ai(db, month, day):
    db.execute("CREATE TABLE IF NOT EXISTS ai_attempts (month TEXT, day TEXT)")
    with db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT COUNT(*) FROM ai_attempts WHERE month=?", (month,)).fetchone()[0] >= MONTH_CAP:
            return False
        if db.execute("SELECT COUNT(*) FROM ai_attempts WHERE day=?", (day,)).fetchone()[0] >= DAY_CAP:
            return False
        db.execute("INSERT INTO ai_attempts VALUES (?,?)", (month,day))
        return True

def build_payload(category, lang):
    if category not in ("registration", "tokens", "password") or lang not in ("ru","kk"):
        return None
    public_facts = (KK if lang == "kk" else RU)[category]
    return {
        "model": MODEL, "store": False, "max_output_tokens": 400,
        "instructions": "Ты тестовая служба поддержки AI Lawyer Kazakhstan. Переформулируй только предоставленный утвержденный публичный текст. Не добавляй факты, цены, сроки, обещания, ссылки, инструкции по платежам или юридические советы. Язык ответа: " + ("казахский" if lang=="kk" else "русский") + ".",
        "input": public_facts
    }

def generate_test_answer(db, category, lang, credential_path):
    payload = build_payload(category,lang)
    if payload is None:
        return None
    try:
        key = Path(credential_path).read_text().strip()
        if not key:
            return None
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if not reserve_ai(db,stamp[:7],stamp):
            return None
        req = urllib.request.Request("https://api.openai.com/v1/responses",
            data=json.dumps(payload).encode(), headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"},method="POST")
        with urllib.request.urlopen(req, timeout=25) as response:
            d = json.load(response)
        if d.get("status") != "completed":
            return None
        answer = "\n".join(c["text"] for o in d.get("output",[]) for c in o.get("content",[]) if c.get("type")=="output_text").strip()
        if not answer or len(answer)>1800 or "https://ailawyer.kz/chat/" not in answer:
            return None
        # Only used for internal test replies, never automatic customer delivery.
        return answer
    except Exception:
        return None
