// Bounded official primary and procedural authority retrieval for Kazakhstan
// executive-inscription consultations. In a dated dispute, a CURRENT article
// supplements but must never replace the archived version for earlier acts.
import crypto from "node:crypto";
import {getLiveOfficialArticleContext} from "./live-official.mjs";

const MAX_BYTES=2300000;
function textOf(html){
  return String(html).replace(/<br\s*\/?>/gi,"\n")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ")
    .replace(/&laquo;/gi,"«").replace(/&raquo;/gi,"»")
    .replace(/&amp;/gi,"&").replace(/[^\S\n]+/g," ").trim();
}
export function isNotarialInscriptionQuestion(query){
  const s=String(query||"");
  return /(?:исполнител\p{L}{0,10}\s+надпис\p{L}*|нотари\p{L}*\s+надпис\p{L}*)/iu.test(s);
}
export function extractCourtInstruction(html){
  if(typeof html!=="string"||html.length<800||html.length>MAX_BYTES)
    throw Error("Unreliable official normative resolution");
  const section=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!section)throw Error("Official resolution text missing");
  const paragraphs=[...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(x=>textOf(x[1]))
    .filter(x=>x.length>30&&x.length<4500);
  const references=paragraphs.filter(x=>/(?:част[ьи]\s+четверт\p{L}*\s+статьи\s+364|десятидневн\p{L}*\s+срок|срок.{0,50}календарн\p{L}*\s+дн\p{L}*)/iu.test(x));
  if(!references.length)throw Error("Relevant official judicial paragraphs absent");
  return references.slice(0,4).map(x=>x.slice(0,1900));
}
async function fetchCourtResolution(id,fetchImpl){
  if(id!=="P220000006S")throw Error("Unapproved court source");
  const url="https://old.adilet.zan.kz/rus/docs/"+id;
  const r=await fetchImpl(url,{method:"GET",redirect:"error",
    headers:{accept:"text/html,application/xhtml+xml"},
    signal:AbortSignal.timeout(6000)});
  if(!r.ok||!/text\/html|application\/xhtml\+xml/i.test(r.headers.get("content-type")||"")||
     !r.body||Number(r.headers.get("content-length")||0)>MAX_BYTES)
    throw Error("Official court resolution unavailable");
  let bytes=0;const chunks=[];
  for await(const chunk of r.body){
    bytes+=chunk.byteLength;
    if(bytes>MAX_BYTES){await r.body.cancel().catch(()=>{});throw Error("Oversized resolution");}
    chunks.push(Buffer.from(chunk));
  }
  const html=Buffer.concat(chunks).toString("utf8");
  const paragraphs=extractCourtInstruction(html);
  return "\nНОРМАТИВНОЕ ПОСТАНОВЛЕНИЕ ВЕРХОВНОГО СУДА РК № 6 ОТ 26.05.2022."+
    "\nОфициальный источник: "+url+"; дата загрузки: "+new Date().toISOString().slice(0,10)+
    "; полученные выдержки — НЕ самостоятельная проверка исторической редакции и НЕ основание подменять ГПК."+
    "\nSHA256 выдержек: "+crypto.createHash("sha256").update(paragraphs.join("\n"),"utf8").digest("hex")+
    "\n"+paragraphs.map((p,i)=>"Пункт-фрагмент "+(i+1)+": "+p).join("\n");
}
export async function getNotarialCompanionContext(registry,question,{
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10)
}={}){
  if(process.env.LIVE_OFFICIAL_LAW_ENABLED==="0"||
     !isNotarialInscriptionQuestion(question))return "";
  const notary=registry.find(x=>x.id==="notary"&&x.actId==="Z970000155_");
  const gpk=registry.find(x=>x.id==="gpk"&&x.actId==="K1500000377");
  const court=registry.find(x=>x.id==="np-notarial-inscription"&&x.actId==="P220000006S");
  const jobs=[
    notary?getLiveOfficialArticleContext([notary],"статья 92-8 о нотариате",{fetchImpl,asOf}):Promise.resolve(""),
    gpk?getLiveOfficialArticleContext([gpk],"ГПК статья 364 нотариальное действие",{fetchImpl,asOf}):Promise.resolve(""),
    court?fetchCourtResolution(court.actId,fetchImpl).catch(()=>"\nНП ВС № 6: полный текст судебных разъяснений сейчас не получен. Официальный адрес: https://old.adilet.zan.kz/rus/docs/P220000006S. НЕ утверждай проверку точного срока по этому источнику."):Promise.resolve("")
  ];
  const [currentNotary,gpkArticle,courtExcerpt]=await Promise.all(jobs.map(p=>p.catch(()=>'')));
  return ("\nДОПОЛНИТЕЛЬНЫЕ ПРОЦЕССУАЛЬНЫЕ ИСТОЧНИКИ ПО ИСПОЛНИТЕЛЬНОЙ НАДПИСИ.\n"+
    "Следующие тексты запрошены отдельно от архивного анализа, поскольку вопросы совершения нотариального действия и обращения в суд могут относиться к разным датам. "+
    "Проверь историческую применимость, процессуальное исчисление и переходные положения. "+
    "В особенности разграничивай 10 РАБОЧИХ дней для возражения нотариусу и отдельный судебный срок; не считай их одним сроком.\n"+
    (currentNotary?"\nЗАКОН О НОТАРИАТЕ — ТЕКСТ ОФИЦИАЛЬНОЙ СТРАНИЦЫ НА ДАТУ ЗАГРУЗКИ (не редакция 2024 года):\n"+
      currentNotary.slice(0,6400):"\nАктуальный текст статьи 92-8 не получен; не выдавай его за проверенный.")+
    (gpkArticle?"\nГПК РК — СТАТЬЯ 364, ТЕКСТ С ОФИЦИАЛЬНОЙ СТРАНИЦЫ:\n"+
      gpkArticle.slice(0,4800):"\nТекст статьи 364 ГПК не получен; не утверждай проверку её срока.")+
    (courtExcerpt?"\n"+courtExcerpt.slice(0,4600):"\nТекст НП ВС № 6 не получен; не утверждай проверку его положений.")
  ).slice(0,15000);
}
