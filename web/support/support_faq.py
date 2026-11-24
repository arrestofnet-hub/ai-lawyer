"""Conservative local FAQ routing. No customer data is transmitted externally."""
import re
import unicodedata

RU = {
 "registration": "Для регистрации откройте https://ailawyer.kz/chat/ и выберите «Регистрация». Подтвердите электронную почту или воспользуйтесь входом через Google, если он доступен.",
 "tokens": "Баланс и актуальные тарифы указаны в разделе «Тарифы»: https://ailawyer.kz/chat/. Токены AI Lawyer — внутренние единицы учета сервиса.",
 "password": "Откройте https://ailawyer.kz/chat/ и воспользуйтесь восстановлением пароля. Проверьте папку «Спам». Никому не сообщайте пароль и код подтверждения.",
 "manual": "Ваш вопрос требует индивидуального рассмотрения службой поддержки. Не отправляйте пароли, банковские коды и полные реквизиты карт."
}
KK = {
 "registration": "Тіркелу үшін https://ailawyer.kz/chat/ сайтын ашып, «Тіркелу» батырмасын таңдаңыз. Электрондық поштаны растаңыз немесе қолжетімді болса, Google арқылы кіріңіз.",
 "tokens": "Токендер қалдығы мен қолданыстағы тарифтер «Тарифтер» бөлімінде көрсетіледі: https://ailawyer.kz/chat/. AI Lawyer токендері — сервистің ішкі есеп бірліктері.",
 "password": "https://ailawyer.kz/chat/ сайтын ашып, құпиясөзді қалпына келтіру мүмкіндігін пайдаланыңыз. «Спам» қалтасын тексеріңіз. Құпиясөз бен растау кодын ешкімге бермеңіз.",
 "manual": "Сұрағыңызды қолдау қызметі жеке қарауы қажет. Құпиясөздерді, банк кодтарын және карта деректерін жібермеңіз."
}
PATTERNS = {
 "registration": {"как зарегистрироваться", "как создать аккаунт", "как пройти регистрацию", "қалай тіркелемін", "қалай тіркелуге болады", "тіркелу жолы"},
 "tokens": {"сколько стоят токены", "где посмотреть тарифы", "какие тарифы", "как посмотреть баланс токенов", "токендер қанша тұрады", "тарифтер қандай", "токен қалдығын қалай көремін"},
 "password": {"как восстановить пароль", "забыл пароль", "забыла пароль", "құпиясөзді қалай қалпына келтіремін", "құпиясөзімді ұмытып қалдым"},
}
def classify(text):
    if not isinstance(text, str):
        return "manual", "ru"
    lang = "kk" if re.search(r"[әіңғүұқөһ]", text.lower()) else "ru"
    if len(text) > 500:
        return "manual", lang
    normalized = unicodedata.normalize("NFKC", text).lower().strip()
    normalized = re.sub(r"^(здравствуйте|добрый день|сәлеметсіз бе|сәлем)[!,.\s]+", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip(" ?!.,")
    for category, variants in PATTERNS.items():
        if normalized in variants:
            return category, lang
    return "manual", lang

def plain_text(message):
    # Accept ordinary plain mail and simple text/HTML alternatives, not attachments.
    if message.is_multipart():
        if message.get_content_type() != "multipart/alternative":
            return None
        parts = list(message.iter_parts())
        if any(p.is_multipart() or p.get_content_disposition() == "attachment" or p.get_filename() or p.get_content_type() not in ("text/plain", "text/html") for p in parts):
            return None
        plain = [p for p in parts if p.get_content_type() == "text/plain"]
        if len(plain) != 1:
            return None
        message = plain[0]
    if message.get_content_type() != "text/plain" or message.get_content_disposition() == "attachment" or message.get_filename():
        return None
    try:
        text = message.get_content()
        return text if isinstance(text, str) and len(text) <= 500 else None
    except Exception:
        return None

def reply_for(text):
    category, lang = classify(text)
    table = KK if lang == "kk" else RU
    greeting = "Сәлеметсіз бе!" if lang == "kk" else "Здравствуйте!"
    signature = "AI Lawyer Kazakhstan қолдау қызметі" if lang == "kk" else "Служба поддержки AI Lawyer Kazakhstan"
    return category, greeting + "\n\n" + table[category] + "\n\n" + signature
