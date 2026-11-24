import unittest
from email.message import EmailMessage
from support_worker import test_message,init_db,reserve,advance,SUBJECT

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

if __name__=="__main__":
    unittest.main()
