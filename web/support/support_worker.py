#!/usr/bin/env python3
"""Isolated, test-only mail poller. No customer content is sent to AI."""
import hashlib
import imaplib
import json
import os
import re
import smtplib
import sqlite3
import ssl
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr
from pathlib import Path
from support_faq import plain_text, reply_for

SUBJECT = "AI Lawyer AUTO TEST"
ANSWER = ("Здравствуйте! Служба поддержки AI Lawyer Kazakhstan работает.\n\n"
          "Для регистрации откройте https://ailawyer.kz/chat/ и выберите «Регистрация». "
          "Гостевой доступ — 20 000 токенов, после подтверждения регистрации — ещё 20 000. "
          "Онлайн-оплата пока подключается. Тарифы доступны на сайте.\n\n"
          "Это автоматическое тестовое сообщение.\n"
          "Служба поддержки AI Lawyer Kazakhstan")

def test_message(h, sender):
    if not sender or str(h.get("Subject", "")).strip() != SUBJECT:
        return False
    if len(h.get_all("From", [])) != 1 or parseaddr(str(h["From"]))[1].lower() != sender.lower():
        return False
    if str(h.get("Auto-Submitted", "no")).lower() != "no":
        return False
    if any(h.get(k) for k in ("List-Id", "List-Unsubscribe", "X-Auto-Response-Suppress")):
        return False
    if str(h.get("Precedence", "")).lower() in ("bulk", "list", "junk"):
        return False
    return True

def init_db(path):
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK(id=1), validity TEXT, uid INTEGER)")
    db.execute("CREATE TABLE IF NOT EXISTS attempts (digest TEXT PRIMARY KEY, status TEXT NOT NULL)")
    db.commit()
    return db

def reserve(db, digest):
    with db:
        cur = db.execute("INSERT OR IGNORE INTO attempts VALUES (?, 'attempted')", (digest,))
    return cur.rowcount == 1

def advance(db, validity, uid):
    with db:
        db.execute("INSERT INTO cursor VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET validity=excluded.validity, uid=excluded.uid", (validity, uid))

def run():
    cfg = Path(os.environ["CREDENTIALS_DIRECTORY"]) / "mail.json"
    c = json.loads(cfg.read_text())
    # Production replies cannot be activated by changing this configuration.
    # Only the explicitly configured test sender and exact test subject are supported.
    sender = c.get("test_sender", "").strip().lower()
    if not re.fullmatch(r"[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", sender):
        raise RuntimeError("Test sender not configured")
    if c.get("auto_reply") is not False:
        raise RuntimeError("Production replies not implemented")
    db = init_db(Path(os.environ["STATE_DIRECTORY"]) / "state.sqlite3")
    ctx = ssl.create_default_context()
    try:
        with imaplib.IMAP4_SSL(c["host"], c["imap_port"], ssl_context=ctx, timeout=20) as m:
            m.login(c["email"], c["password"])
            status, _ = m.select("INBOX", readonly=True)
            if status != "OK":
                raise RuntimeError("Cannot select inbox")
            validity = m.response("UIDVALIDITY")[1][0].decode("ascii")
            next_uid = int(m.response("UIDNEXT")[1][0])
            row = db.execute("SELECT validity,uid FROM cursor WHERE id=1").fetchone()
            if not row or row[0] != validity:
                advance(db, validity, next_uid - 1)
                print("INITIALIZED: only future mail is checked")
                return
            last = row[1]
            status, data = m.uid("search", None, "UID", f"{last+1}:*")
            if status != "OK":
                raise RuntimeError("Cannot search inbox")
            uids = sorted(int(x) for x in data[0].split() if int(x) > last)[:50]
            for uid in uids:
                status, parts = m.uid("fetch", str(uid), "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID AUTO-SUBMITTED LIST-ID LIST-UNSUBSCRIBE PRECEDENCE X-AUTO-RESPONSE-SUPPRESS)])")
                if status != "OK":
                    raise RuntimeError("Cannot read headers")
                raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
                if raw is None:
                    raise RuntimeError("Missing headers")
                h = BytesParser(policy=policy.default).parsebytes(raw)
                if test_message(h, sender):
                    mid = str(h.get("Message-ID", "")).strip()
                    digest = hashlib.sha256((sender+"|"+(mid or f"{validity}:{uid}")).encode()).hexdigest()
                    if reserve(db, digest):
                        try:
                            status, size_parts = m.uid("fetch", str(uid), "(RFC822.SIZE)")
                            size_raw = b" ".join(p for p in size_parts or [] if isinstance(p, bytes))
                            size_match = re.search(rb"RFC822\.SIZE (\d+)", size_raw)
                            text = None
                            if status == "OK" and size_match and int(size_match.group(1)) <= 32768:
                                status, full = m.uid("fetch", str(uid), "(BODY.PEEK[])")
                                payload = next((p[1] for p in full or [] if isinstance(p, tuple)), None)
                                if status == "OK" and payload is not None and len(payload) <= 32768:
                                    text = plain_text(BytesParser(policy=policy.default).parsebytes(payload))
                            category, answer = reply_for(text)
                            msg = EmailMessage()
                            msg["From"] = c["email"]
                            msg["To"] = sender  # never use untrusted Reply-To
                            msg["Subject"] = "Re: " + SUBJECT
                            msg["Auto-Submitted"] = "auto-replied"
                            if re.fullmatch(r"<[^<>\s]{1,240}>", mid):
                                msg["In-Reply-To"] = mid
                            msg.set_content(answer + "\n\n[TEST: " + category + "]")
                            with smtplib.SMTP_SSL(c["host"], c["smtp_port"], context=ctx, timeout=20) as smtp:
                                smtp.login(c["email"], c["password"])
                                smtp.send_message(msg, from_addr=c["email"], to_addrs=[sender])
                            with db:
                                db.execute("UPDATE attempts SET status='sent' WHERE digest=?", (digest,))
                            print("TEST REPLY: SENT", category)
                        except Exception:
                            # SMTP delivery can be ambiguous. Do not retry automatically.
                            print("TEST REPLY: CHECK MANUALLY")
                advance(db, validity, uid)
            print("POLL: OK")
    finally:
        db.close()

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print("ERROR:", type(e).__name__)
        raise SystemExit(1)
