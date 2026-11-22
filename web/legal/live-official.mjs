// Live, bounded retrieval from the official Әділет publication.
// A fetched article is a dated official-page observation, NOT proof that this
// edition had entered into force on the date of the user's events.
import crypto from "node:crypto";
import {selectProvisionSources} from "./sources.mjs";
import {extractOfficialArticleBlocks} from "./article-boundaries.mjs";

const OFFICIAL_HOSTS=new Set(["adilet.zan.kz","old.adilet.zan.kz"]);
const PAGE_CACHE=new Map();
const CACHE_MS=10*60*1000;
const ENTITY_MAP={nbsp:" ",amp:"&",quot:'"',apos:"'",lt:"<",gt:">",
  laquo:"«",raquo:"»",mdash:"—",ndash:"–",hellip:"…"};
function decodeEntities(s){
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,(_,entity)=>{
    if(entity[0]==="#"){
      const hex=/^#x/i.test(entity);
      const n=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):" ";
    }
    return ENTITY_MAP[entity.toLowerCase()]??" ";
  });
}
function plainHtml(html){
  return decodeEntities(html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi,"")
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<\/(?:p|h[1-6]|li|div|section)>/gi,"\n")
    .replace(/<[^>]*>/g,"")
    .replace(/\u00a0/g," ")
    .replace(/[^\S\n]+/g," ")
    .replace(/[ \t]*\n[ \t]*/g,"\n")
    .replace(/\n{3,}/g,"\n\n")).trim();
}
export function parseOfficialArticles(html,articleNumbers){
  const blocks=extractOfficialArticleBlocks(html);
  const wanted=new Set(articleNumbers.map(String));
  const found=[];
  for(const block of blocks){
    const number=block.article;
    if(!wanted.has(number))continue;
    const text=plainHtml(block.html);
    if(!text.startsWith("Статья "+number+".")||text.length<100||text.length>6500||
       /\nСтатья\s+\d+(?:-\d+)?\./.test(text.slice(25)))continue;
    found.push({article:number,anchor:block.anchor,text,
      sha256:crypto.createHash("sha256").update(text,"utf8").digest("hex")});
  }
  return found;
}
export function isCivilAssignmentQuestion(query){
  return /(?:уступк\p{L}*\s+(?:права\s+)?требован\p{L}*|переход\p{L}*\s+прав\p{L}*\s+(?:требован\p{L}*|кредитор\p{L}*)|цессия|нов\p{L}*\s+кредитор\p{L}*|право\s+требования\s+перешло|реестр\p{L}*\s+передаваем\p{L}*\s+требован\p{L}*)/iu.test(String(query||""));
}
export function specificNumbers(query,source){
  const nums=new Set();
  const re=/(?:стат(?:ья|ьи|ью|ье|ей)|ст\.)\s*№?\s*(\d{1,4}(?:-\d{1,2})?)/giu;
  for(const m of String(query).matchAll(re))nums.add(m[1]);
  if(source.id==="gk-general"&&isCivilAssignmentQuestion(query)){
    // Verified subject-area navigation, not a claim that current or
    // historical article texts have already been fetched or checked.
    for(const num of ["339","341","342","343","345","346"])nums.add(num);
  }
  // The user may ask about "grounds and deadlines of cancelling an
  // executive inscription" without knowing the relevant article numbers.
  if(source.id==="notary"&&/исполнител\p{L}{0,10}\s+надпис|надпис.{0,20}нотари/iu.test(query)){
    nums.add("92-6");nums.add("92-8");
  }
  return [...nums].slice(0,source.id==="gk-general"?7:4);
}
function officialPageUrl(source,host){
  const u=new URL(source.officialUrl);
  if(u.protocol!=="https:"||u.hostname!=="adilet.zan.kz"||u.port||
     !/^\/rus\/docs\/[A-Z][A-Za-z0-9_]{5,30}$/.test(u.pathname))
    throw Error("Unexpected official source");
  u.hostname=host;
  return u.href;
}
async function fetchPage(url,fetchImpl){
  const u=new URL(url);
  if(u.protocol!=="https:"||!OFFICIAL_HOSTS.has(u.hostname)||
     u.username||u.password||u.port||u.search||u.hash)throw Error("Untrusted source");
  // A compare fallback is only authorized for the GK General Part.
  // Never follow arbitrary comparison links from documents or user inputs.
  if(u.pathname.endsWith("/compare")&&
     u.pathname!=="/rus/docs/K940001000_/compare")
    throw Error("Unapproved comparison page");
  const useCache=fetchImpl===globalThis.fetch;
  const cached=useCache?PAGE_CACHE.get(url):null;
  if(cached&&cached.until>Date.now())return cached.text;
  const response=await fetchImpl(url,{method:"GET",redirect:"error",
    headers:{accept:"text/html,application/xhtml+xml"},
    signal:AbortSignal.timeout(url.includes("K940001000_")?12000:7000)});
  if(!response.ok||!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type")||""))
    throw Error("Official page unavailable");
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>8500000)throw Error("Official page too large");
  // Reject oversized streamed responses even if Content-Length was omitted.
  let size=0;const parts=[];
  if(!response.body)throw Error("Official response body missing");
  for await(const chunk of response.body){
    size+=chunk.byteLength;
    if(size>8500000){await response.body.cancel().catch(()=>{});throw Error("Official page too large");}
    parts.push(Buffer.from(chunk));
  }
  const text=Buffer.concat(parts).toString("utf8");
  if(useCache){
    PAGE_CACHE.set(url,{text,until:Date.now()+CACHE_MS});
    if(PAGE_CACHE.size>20)PAGE_CACHE.delete(PAGE_CACHE.keys().next().value);
  }
  return text;
}
export async function getLiveOfficialArticleContext(officialRegistry,query,{
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10)
}={}){
  if(process.env.LIVE_OFFICIAL_LAW_ENABLED==="0")return "";
  const matched=selectProvisionSources(officialRegistry,query,{max:5});
  const gk=officialRegistry.find(x=>x.id==="gk-general");
  if(gk&&isCivilAssignmentQuestion(query)){
    // The substantive-law question belongs to GK General Part even if
    // a user also mentions a loan (GK Special Part), penalties or court.
    matched.unshift(gk);
  }
  const unique=[...new Map(matched.map(source=>[source.id,source])).values()];
  const jobs=unique.map(source=>({source,numbers:specificNumbers(query,source)}))
    .filter(x=>x.numbers.length).slice(0,1);
  if(!jobs.length)return "";
  const {source,numbers}=jobs[0];
  let extracts=[],from="";
  const canonicalOld=officialPageUrl(source,"old.adilet.zan.kz");
  const canonicalNew=officialPageUrl(source,"adilet.zan.kz");
  const candidates=source.id==="gk-general"?
    [canonicalOld,canonicalOld+"/compare",canonicalNew]:
    [canonicalOld,canonicalNew];
  for(const url of candidates){
    try{
      const html=await fetchPage(url,fetchImpl);
      const candidate=parseOfficialArticles(html,numbers);
      // Keep the most complete verified extraction, not a later partial
      // or an HTML table-of-contents misidentified as an article.
      if(candidate.length>extracts.length){
        extracts=candidate;from=url;
      }
      if(extracts.length===numbers.length)break;
    }catch{ /* Network/parser failures must not break a paid consultation. */ }
  }
  if(!extracts.length)return "\nПРОВЕРКА ОФИЦИАЛЬНОГО ИСТОЧНИКА: онлайн-текст нужных статей Әділет недоступен. "+
    "Не говори, что проверил статьи или сроки по сайту. Покажи официальный URL "+
    source.officialUrl+" и запроси сверку текста и редакции.\n";
  const missing=numbers.filter(n=>!extracts.some(x=>x.article===n));
  const compareNotice=from.endsWith("/compare")?
    "\nВНИМАНИЕ: статьи извлечены с официальной СРАВНИТЕЛЬНОЙ страницы Әділет. "+
    "Это источник для сверки текста, НЕ доказательство, что именно эта редакция "+
    "действовала на дату события. Для правового вывода нужна проверка "+
    "исторической редакции и переходных положений.\n":"\n";
  return ("\nОНЛАЙН-ИЗВЛЕЧЕНИЕ ИЗ ОФИЦИАЛЬНОЙ ПУБЛИКАЦИИ ӘДІЛЕТ. "+
    "Дата получения страницы: "+asOf+". Это фактически полученный текст, "+
    "НО НЕ ПРОВЕРКА ДАТЫ ВСТУПЛЕНИЯ В СИЛУ И НЕ ИСТОРИЧЕСКАЯ РЕДАКЦИЯ. "+
    "Для событий в прошлом проверь историю и переходные положения. "+
    "Указывай точную статью и официальный URL для каждого извлечённого правила. "+
    "Не утверждай, что URL проверен на другую дату.\n"+compareNotice+
    extracts.map(x=>"СТАТЬЯ "+x.article+"; акт: "+source.title+
      "; официальный адрес: "+source.officialUrl+(x.anchor?"#"+x.anchor:"")+
      "; источник фактической загрузки: "+from+
      "; SHA256: "+x.sha256+"; дата загрузки: "+asOf+
      "; редакция/вступление в силу НЕ подтверждены.\n"+x.text).join("\n\n")+
    (missing.length?"\nНе удалось получить полный текст статей: "+missing.join(", ")+". Не цитировать их как проверенные.":"")
  ).slice(0,source.id==="gk-general"?19000:15000);
}
