// Case-specific official rules for stopping recovery on a disputed
// notarial executive inscription. Distinguish a court injunction from
// the bailiff's separate statutory grounds to pause enforcement.
import {extractOfficialArticleBlocks} from "./article-boundaries.mjs";

const GPK="https://old.adilet.zan.kz/rus/docs/K1500000377";
const COURT="https://old.adilet.zan.kz/rus/docs/P220000006S";
const MAX_BYTES=2000000;
function clean(s){
  return String(s||"").replace(/<br\s*\/?>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ")
    .replace(/\s+/g," ").trim();
}
function paragraphs(html){
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m=>clean(m[1])).filter(Boolean);
}
export function parseCourtStayProvisions(html){
  if(typeof html!=="string"||html.length<350||html.length>MAX_BYTES)
    throw Error("Official court resolution unavailable");
  const body=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!body)throw Error("Official court resolution body missing");
  const p=paragraphs(body);
  const excerpt=p.find(x=>/Если\s+на\s+момент\s+подачи\s+жалобы\s+на\s+нотариальное\s+действие/iu.test(x)&&
    /возбуждено\s+исполнительное\s+производство/iu.test(x)&&
    /приостановлении\s+взыскания\s+по\s+исполнительной\s+надписи/iu.test(x));
  if(!excerpt||excerpt.length>1450)throw Error("No specific judicial stay explanation");
  return {text:excerpt,url:COURT+"#z24"};
}
export function parseCivilProcedureStayProvisions(html){
  const blocks=extractOfficialArticleBlocks(html,{maxBytes:MAX_BYTES});
  const block=(n)=>blocks.find(x=>x.article===String(n))?.html||"";
  const b156=block(156),b157=block(157),b158=block(158);
  if(!b156||!b157||!b158)throw Error("GPK articles 156–158 not present");
  // Article 157 on the official 2026 page has no heading anchor.
  // Link to the first paragraph id (z1078 in that edition), not a
  // fabricated #z157 fragment.
  const first157Body=b157.slice(b157.indexOf("</p>")+4);
  const article157Anchor=blocks.find(x=>x.article==="157")?.anchor||
    first157Body.match(/<p\b[^>]*\bid=["'](z\d+)["']/i)?.[1]||null;
  const p156=paragraphs(b156);
  const clause=p156.find(x=>/^6\)\s*приостановление\s+взыскания\s+по\s+исполнительному\s+документу/iu.test(x)&&
    /оспариваемому\s+(?:ответчиком|должником)\s+в\s+судебном\s+порядке/iu.test(x));
  const p157=paragraphs(b157);
  const filing=p157.find(x=>/^1\.\s*Заявление\s+об\s+обеспечении\s+иска/iu.test(x)&&
    /в\s+день\s+(?:вынесения\s+определения\s+о\s+возбуждении|его\s+поступления)/iu.test(x));
  // In the real Әділет HTML article 157(2) is split into two <p>
  // elements: paragraph 2 states "без извещения лиц", and the immediately
  // following paragraph states "судья выносит определение". Do not require
  // these independent sentences to appear in one HTML paragraph.
  const decisionIndex=p157.findIndex(x=>
    /^2\.\s*Заявление\s+об\s+обеспечении\s+иска/iu.test(x)&&
    /без\s+извещения\s+лиц/iu.test(x));
  const decisionPart=decisionIndex<0?"":p157.slice(decisionIndex,decisionIndex+2).join(" ");
  const decision=/(?:выносит|вынес[а-яё]+)\s+определение\s+об\s+обеспечении\s+иска/iu.test(decisionPart)
    &&/об\s+отказе\s+в\s+удовлетворении\s+заявления/iu.test(decisionPart)
    ?decisionPart:null;
  const p158=paragraphs(b158);
  const delivery=p158.find(x=>/^2\)\s*в\s+соответствующий\s+орган\s+юстиции\s+либо\s+в\s+региональную\s+палату/iu.test(x)&&
    /приостановления\s+исполнительного\s+производства/iu.test(x)&&
    /подпунктами\s+6\),\s*8\)\s+части\s+первой\s+статьи\s+156/iu.test(x));
  if(!clause||!filing||!decision||!delivery)
    throw Error("Relevant GPK procedure fragments missing");
  return {article156:clause,article157:filing+"\n"+decision,
    article158:delivery,urls:{
      article156:GPK+"#z156",article157:GPK+(article157Anchor?"#"+article157Anchor:""),article158:GPK+"#z158"
    }};
}
async function loadOfficial(url,fetchImpl){
  if(url!==GPK&&url!==COURT)throw Error("Unapproved legal source");
  const r=await fetchImpl(url,{method:"GET",redirect:"error",
    headers:{accept:"text/html,application/xhtml+xml"},
    signal:AbortSignal.timeout(7000)});
  if(!r.ok||!/text\/html|application\/xhtml\+xml/i.test(r.headers.get("content-type")||"")||
     !r.body||Number(r.headers.get("content-length")||0)>MAX_BYTES)
    throw Error("Official legal page not available");
  let size=0;const chunks=[];
  for await(const chunk of r.body){
    size+=chunk.byteLength;
    if(size>MAX_BYTES){
      await r.body.cancel().catch(()=>{});
      throw Error("Official legal page exceeds size limit");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function getNotarialCollectionStayContext({
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10)
}={}){
  if(process.env.LIVE_OFFICIAL_LAW_ENABLED==="0"||
     process.env.NOTARIAL_COLLECTION_STAY_ENABLED==="0")return "";
  const [gpk,nps]=await Promise.all([
    loadOfficial(GPK,fetchImpl).then(parseCivilProcedureStayProvisions)
      .catch(()=>null),
    loadOfficial(COURT,fetchImpl).then(parseCourtStayProvisions)
      .catch(()=>null)
  ]);
  let context="\nОСОБЫЙ ВОПРОС: ПРИОСТАНОВЛЕНИЕ ВЗЫСКАНИЯ ПО ИСПОЛНИТЕЛЬНОЙ НАДПИСИ. "+
    "Источник проверяется по тексту официальной страницы Әділет, полученной "+asOf+
    ". Это не заключение о редакции нормы в 2024 г. "+
    "Жалоба и ходатайство сами по себе НЕ приостанавливают исполнение. "+
    "НЕ путай приостановление взыскания по судебному определению с самостоятельным "+
    "постановлением ЧСИ о приостановлении исполнительного производства "+
    "по исчерпывающим основаниям специального закона. "+
    "НЕ советуй ЧСИ приостановить дело только потому, что подана жалоба.";
  if(gpk){
    context+="\nГПК РК, подпункт 6) части 1 статьи 156. Источник: "+
      gpk.urls.article156+". Норма: "+gpk.article156+
      "\nГПК РК, статья 157 (порядок рассмотрения). Источник: "+
      gpk.urls.article157+". Норма: "+gpk.article157+
      "\nГПК РК, подпункт 2) части 1 статьи 158 (адресат судебного определения). Источник: "+
      gpk.urls.article158+". Норма: "+gpk.article158;
  }else context+="\nСТАТЬИ 156–158 ГПК: точные положения официального текста не получены. "+
    "Нельзя утверждать, что конкретные подпункты проверены.";
  if(nps){
    context+="\nНормативное постановление ВС № 6 от 26.05.2022, "+
      "официальное разъяснение о приостановлении взыскания. Источник: "+
      nps.url+". Текст: "+nps.text;
  }else context+="\nНП ВС № 6: точное разъяснение о приостановлении взыскания не подтверждено.";
  context+="\nПРАКТИЧЕСКАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ: "+
    "(1) определить судебное производство (жалоба на нотариальное действие либо иск); "+
    "(2) подать в рассматривающий дело суд отдельное заявление о приостановлении "+
    "взыскания по конкретной исполнительной надписи с номером и датой; "+
    "(3) приложить постановление о возбуждении ИП, документы об арестах/удержаниях "+
    "и объяснение риска продолжающегося исполнения; "+
    "(4) получить судебное определение, если суд удовлетворит заявление; "+
    "(5) направить судебное определение в надлежащий орган юстиции "+
    "либо региональную палату ЧСИ в порядке статьи 158 и уведомить ЧСИ; "+
    "(6) проверить фактическое исполнение определения и текущий статус взыскания. "+
    "Не обещай, что обеспечительные меры будут приняты автоматически.";
  return context.slice(0,8600);
}

// Machine-checkable status based on complete official-source excerpts;
// a casual mention of "статьи 158" in an instructional paragraph must
// NEVER count as verification.
export function getNotarialStayEvidenceStatus(context){
  const c=String(context||"");
  return {
    article156:/\nГПК РК, подпункт 6\) части 1 статьи 156\. Источник: https:\/\/old\.adilet\.zan\.kz\/rus\/docs\/K1500000377#z156\. Норма: 6\) приостановление взыскания по исполнительному документу/iu.test(c),
    article157:/\nГПК РК, статья 157 \(порядок рассмотрения\)\. Источник: https:\/\/old\.adilet\.zan\.kz\/rus\/docs\/K1500000377(?:#z\d+)?\. Норма: 1\. Заявление об обеспечении иска[\s\S]*?без извещения лиц[\s\S]*?выносит определение об обеспечении иска/iu.test(c),
    article158:/\nГПК РК, подпункт 2\) части 1 статьи 158 \(адресат судебного определения\)\. Источник: https:\/\/old\.adilet\.zan\.kz\/rus\/docs\/K1500000377#z158\. Норма: 2\) в соответствующий орган юстиции либо в региональную палату/iu.test(c),
    supremeCourt:/\nНормативное постановление ВС № 6 от 26\.05\.2022,[\s\S]*?Источник: https:\/\/old\.adilet\.zan\.kz\/rus\/docs\/P220000006S#z24\. Текст: Если на момент подачи жалобы/iu.test(c)
  };
}

