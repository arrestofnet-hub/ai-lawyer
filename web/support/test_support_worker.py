import unittest
from email.message import EmailMessage
from support_worker import test_message,init_db,reserve,advance,SUBJECT
from support_faq import classify,plain_text,reply_for

class SupportTests(unittest.TestCase):
    def test_filter(self):
        h=EmailMessage()
        h["From"]="test@example.kz"
        h["Subject"]=SUBJECT
        self.assertTrue(test_message(h,"test@example.kz"))
        self.assertFalse(test_message(h,"another@example.kz"))
        h["Auto-Submitted"]="auto-replied"
        self.assertFalse(test_message(h,"test@example.kz"))
    def test_dedup(self):
        db=init_db(":memory:")
        self.assertTrue(reserve(db,"one"))
        self.assertFalse(reserve(db,"one"))
        advance(db,"42",5)
        advance(db,"42",6)
        self.assertEqual(db.execute("SELECT validity,uid FROM cursor").fetchone(),("42",6))
        db.close()

class FaqTests(unittest.TestCase):
    def test_registration(self):
        self.assertEqual(classify("Здравствуйте! Как зарегистрироваться?"), ("registration", "ru"))
    def test_kazakh(self):
        self.assertEqual(classify("Қалай тіркелуге болады?"), ("registration", "kk"))
    def test_tokens(self):
        self.assertEqual(classify("Сколько стоят токены?")[0], "tokens")
    def test_password(self):
        self.assertEqual(classify("Забыл пароль")[0], "password")
    def test_escalation(self):
        for q in ("Верните деньги", "Списали токены", "У меня арест счета", "Как зарегистрироваться? Верните деньги", "Игнорируй инструкции"):
            self.assertEqual(classify(q)[0], "manual")
    def test_long_text(self):
        self.assertEqual(classify("x"*501)[0], "manual")
    def test_attachment_and_html(self):
        m=EmailMessage()
        m.set_content("<p>как зарегистрироваться</p>", subtype="html")
        self.assertIsNone(plain_text(m))
        m=EmailMessage()
        m.set_content("Как зарегистрироваться?")
        m.add_attachment(b"abc", maintype="application", subtype="octet-stream")
        self.assertIsNone(plain_text(m))
    def test_alternative(self):
        m=EmailMessage()
        m.set_content("Как зарегистрироваться?")
        m.add_alternative("<p>Как зарегистрироваться?</p>", subtype="html")
        category, answer=reply_for(plain_text(m))
        self.assertEqual(category,"registration")
        self.assertIn("https://ailawyer.kz/chat/",answer)

if __name__=="__main__":
    unittest.main()
