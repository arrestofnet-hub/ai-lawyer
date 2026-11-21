// Size-aware response budgets for reasoning models. The Responses API
// counts hidden reasoning AND visible answer tokens against max_output_tokens.
// A 3-page legal exhibit with a multipart critique must not receive the same
// allowance as a short text-only consultation.
const DETAILED=/(?:полноценн|подробн|полный\s+юридическ|проведи\s+(?:полный|юридический)|все\s+(?:страниц\p{L}*|документ\p{L}*)|прочитай\s+(?:все|полностью)|дословн|кажд\p{L}*\s+существенн\p{L}*\s+формулиров\p{L}*|предмет\s+доказывания|сопостав\p{L}*\s+услови\p{L}*|юридическ\p{L}*\s+анализ)/iu;

export function modelResponseSettings({message="",mode="consult",docCount=0,creditAccount=false}={}){
  const detailed=DETAILED.test(String(message));
  const withDocs=Number.isInteger(docCount)&&docCount>0;
  // Higher allowance is only for genuine selected attachments. No user can
  // request arbitrary output budgets through payload fields.
  let outputTokens;
  if(withDocs){
    // Deep document consultations need both internal reasoning and room to
    // finish the user-facing explanation and source comparisons.
    if(mode==="consult") outputTokens=detailed?12500:9500;
    else if(mode==="audit"||mode==="strategy"||mode==="review")
      outputTokens=detailed?13500:11000;
    else outputTokens=11500;
  }else if(creditAccount){
    outputTokens=mode==="consult"?(detailed?5400:3300):5000;
  }else {
    outputTokens=6500;
  }
  const documentInstruction=withDocs
    ? "\nПРИКРЕПЛЁННЫЕ ДОКУМЕНТЫ: сначала установи предмет спора и полный перечень прочитанных страниц и существенных условий. " +
      "Дословно сопоставь противоречия, суммы, условия и оговорки. Отдельно назови недостающие доказательства. " +
      "Излагай результат по пунктам, без повторов методики, длинных предисловий и повторения вопроса. " +
      "Все запрошенные части заключения доведи до конца в пределах объёма ответа. " +
      "Если часть файла не видна или не прочитана, прямо укажи это, не заявляй о полном изучении. " +
      "Не жертвуй юридической точностью ради краткости и не придумывай юридические факты."
    : "";
  return {
    max_output_tokens:outputTokens,
    reasoning:{effort:"medium"},
    documentInstruction,
    detailed,
    withDocs
  };
}
