// Audit support for legal amendments in official Әділет article editions.
// Historical snapshots and footnotes are EVIDENCE, not legal-effectiveness
// decisions. Never infer effective dates from archive modification dates.
import crypto from "node:crypto";

const HEADING=/<p\b[^>]*>\s*<b\b[^>]*>\s*(?:<a\b[^>]*\bname=["']z\d+["'][^>]*>\s*<\/a>\s*)?Статья\s+(\d+(?:-\d+)?)\.\s*[^<]{3,180}<\/b>\s*<\/p>/gi;
const ID_RX=/^Z[A-Za-z0-9_]{6,30}$/;
function clean(s){
  return String(s||"").replace(/<br\s*\/?>/gi," ").replace(/<[^>]*>/g," ")
    .replace(/&nbsp;|&#160;/gi," ").replace(/&laquo;/gi,"«")
    .replace(/&raquo;/gi,"»").replace(/&amp;/gi,"&")
    .replace(/\s+/g," ").trim();
}
export function classifyEntryRule(note){
  const s=clean(note);
  const explicit=s.match(/вводится\s+в\s+действие\s+с\s+(\d{2}\.\d{2}\.\d{4})/iu);
  if(explicit)return {kind:"date_in_note",observedDate:explicit[1],
    verified:false,reason:"Дата указана в сноске, но применимость поправки и исключения не проверены"};
  if(/по\s+истечении[^.;)]{0,160}(?:официального\s+опубликования|публикации)/iu.test(s))
    return {kind:"after_publication",verified:false,
      reason:"Для вычисления требуется подтверждённая дата первого официального опубликования, а также проверка исключений"};
  if(/порядок\s+введен[ия]*\s+в\s+действие|см\.\s*ст\.\s*\d+/iu.test(s))
    return {kind:"referenced_provision",verified:false,
      reason:"Требуется открыть статью о введении изменяющего закона в действие и проверить исключения"};
  return {kind:"not_established",verified:false,reason:"Начало действия поправки из этой сноски не установлено"};
}
export function extractArticleAmendmentNotes(html,articleNumbers,{actId}={}){
  if(typeof html!=="string"||html.length<500||html.length>5000000)
    throw Error("Invalid official article HTML");
  const body=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!body)throw Error("Missing official article section");
  const headings=[...body.matchAll(HEADING)];
  if(headings.length<2)throw Error("Incomplete official article structure");
  const wanted=new Set(articleNumbers.map(String));
  const result=[];
  for(let i=0;i<headings.length;i++){
    const head=headings[i],number=head[1];
    if(!wanted.has(number))continue;
    const block=body.slice(head.index,headings[i+1]?.index??body.length);
    // Only "Сноска" entries that occur inside the requested article.
    const notes=[...block.matchAll(/<(p|span)\b[^>]*\bclass=["'][^"']*\bnote\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)];
    for(const entry of notes){
      const raw=entry[2],text=clean(raw);
      if(!/Сноска\./iu.test(text))continue;
      const ids=new Set();
      for(const link of raw.matchAll(/href=["'](?:https:\/\/(?:old\.)?adilet\.zan\.kz)?\/rus\/docs\/([A-Z][A-Za-z0-9_]{5,30})(?:#[^"']+)?["']/gi)){
        if(ID_RX.test(link[1])&&link[1]!==actId)ids.add(link[1]);
      }
      // Do not claim that every act in a footnote changed this exact clause.
      if(!ids.size)continue;
      const kind=classifyEntryRule(text);
      result.push({article:number,amendingActIds:[...ids].slice(0,10),
        note:text.slice(0,900),rule:kind,provenance:"official_archive_footnote"});
    }
  }
  return result.slice(0,12);
}
export function compareArchivedArticles(prior,next){
  const current=new Map(prior.map(x=>[x.article,x]));
  const later=new Map(next.map(x=>[x.article,x]));
  return [...current.values()].map(a=>{
    const b=later.get(a.article);
    if(!b)return {article:a.article,status:"not_comparable"};
    const ah=crypto.createHash("sha256").update(a.text,"utf8").digest("hex");
    const bh=crypto.createHash("sha256").update(b.text,"utf8").digest("hex");
    return {article:a.article,status:ah===bh?"same_text":"different_text",
      previousHash:ah,nextHash:bh};
  });
}
export function buildAmendmentReviewContext({
  actId,articleNumbers,eventDate,priorDate,nextDate=null,priorHtml,
  priorArticles,nextHtml=null,nextArticles=[]
}){
  const notes=extractArticleAmendmentNotes(priorHtml,articleNumbers,{actId});
  const comparison=nextHtml?compareArchivedArticles(priorArticles,nextArticles):[];
  let message="\nПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА ПОПРАВОК И СРОКОВ ДЕЙСТВИЯ (НЕ ПРАВОВОЕ ЗАКЛЮЧЕНИЕ):"+
    "\nДата события: "+eventDate+"; архивный текст от "+priorDate+
    (nextDate?"; ближайшая следующая архивная дата "+nextDate:"")+
    ". Дата изменения в истории Әділет НЕ равна дате введения поправки в действие."+
    "\nОфициальное правило исчисления сроков вводов требует сверить закон-изменение, первую официальную публикацию, исключения, переходные положения и возможную обратную силу."+
    "\nЗапрещено утверждать юридическую применимость без этой проверки.";
  if(notes.length){
    message+="\nСноски официальной архивной публикации по статьям:";
    for(const n of notes.slice(0,5)){
      const urls=n.amendingActIds.map(id=>"https://adilet.zan.kz/rus/docs/"+id);
      message+="\nСтатья "+n.article+"; связанные изменяющие акты: "+urls.join(", ")+
        "; правило: "+n.rule.kind+"; подтверждённая дата вступления: НЕТ; причина: "+
        n.rule.reason+". Сноска: "+n.note.slice(0,420);
    }
  }else message+="\nСноски со ссылками на изменяющие законы в этих статьях не распознаны. Это НЕ доказывает отсутствие поправок.";
  if(nextDate){
    message+="\nСОПОСТАВЛЕНИЕ ТЕКСТОВ С БЛИЖАЙШЕЙ СЛЕДУЮЩЕЙ АРХИВНОЙ ВЕРСИЕЙ:";
    if(!comparison.length)message+="\nНе удалось достоверно извлечь следующую версию — вывод об изменении статьи запрещён.";
    for(const x of comparison)
      message+="\nСтатья "+x.article+": "+
        (x.status==="same_text"?"текст совпадает в извлечённых редакциях":
         x.status==="different_text"?"текст отличается (включая сноски и оформление); определить изменение правовой нормы без анализа нельзя":
         "следующая версия не извлечена, сравнение невозможно")+".";
  }
  return {context:message.slice(0,8500),
    summary:{reviewed:false,articleFootnotes:notes.length,
      comparedArticles:comparison.length,comparison}};
}
