// Live, bounded retrieval from the official Әділет publication.
// A fetched article is a dated official-page observation, NOT proof that this
// edition had entered into force on the date of the user's events.
import crypto from "node:crypto";
import {selectOfficialSources} from "./sources.mjs";

const OFFICIAL_HOSTS=new Set(["adilet.zan.kz","old.adilet.zan.kz"]);
const PAGE_CACHE=new Map();
const CACHE_MS=10*60*1000;
const ARTICLE_HEADING=/<p\b[^>]*>\s*<b\b[^>]*>\s*(?:<a\b[^>]*\bname=["'](z\d+)["'][^>]*>\s*<\/a>\s*)?Статья\s+(\d+(?:-\d+)?)\.\s*[^<]{3,180}<\/b>\s*<\/p>/gi;
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
  if(typeof html!=="string"||html.length<500||html.length>8500000)
    throw Error("Invalid official page length");
  // Only the main legal article; ignore page chrome and navigation.
  const part=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!part||part.length<300)throw Error("Official article container missing");
  const headings=[...part.matchAll(ARTICLE_HEADING)];
  if(headings.length<2)throw Error("Full official act text required");
  const wanted=new Set(articleNumbers.map(String));
  const found=[];
  for(let i=0;i<headings.length;i++){
    const h=headings[i],number=h[2];
    if(!wanted.has(number))continue;
    const next=headings[i+1]?.index??part.length;
    const raw=part.slice(h.index,next);
    const text=plainHtml(raw);
    if(!text.startsWith("Статья "+number+".")||text.length<100||text.length>6500||
       /\nСтатья\s+\d+(?:-\d+)?\./.test(text.slice(25)))continue;
    found.push({article:number,anchor:h[1]||null,text,
      sha256:crypto.createHash("sha256").update(text,"utf8").digest("hex")});
  }
  return found;
}
function specificNumbers(query,source){
  const nums=new Set();
  const re=/(?:стат(?:ья|ьи|ью|ье|ей)|ст\.)\s*№?\s*(\d{1,4}(?:-\d{1,2})?)/giu;
  for(const m of String(query).matchAll(re))nums.add(m[1]);
  // The user may ask about "grounds and deadlines of cancelling an
  // executive inscription" without knowing the relevant article numbers.
  if(source.id==="notary"&&/исполнител\p{L}{0,10}\s+надпис|надпис.{0,20}нотари/iu.test(query)){
    nums.add("92-6");nums.add("92-8");
  }
  return [...nums].slice(0,4);
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
  const useCache=fetchImpl===globalThis.fetch;
  const cached=useCache?PAGE_CACHE.get(url):null;
  if(cached&&cached.until>Date.now())return cached.text;
  const response=await fetchImpl(url,{method:"GET",redirect:"error",
    headers:{accept:"text/html,application/xhtml+xml"},
    signal:AbortSignal.timeout(7000)});
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
  const matched=selectOfficialSources(officialRegistry,query,{max:3});
  const jobs=matched.map(source=>({source,numbers:specificNumbers(query,source)}))
    .filter(x=>x.numbers.length).slice(0,1);
  if(!jobs.length)return "";
  const {source,numbers}=jobs[0];
  let extracts=[],from="";
  for(const host of ["old.adilet.zan.kz","adilet.zan.kz"]){
    try{
      const url=officialPageUrl(source,host);
      const html=await fetchPage(url,fetchImpl);
      extracts=parseOfficialArticles(html,numbers);
      if(extracts.length){from=url;break;}
    }catch{ /* Network failures must not break a paid consultation. */ }
  }
  if(!extracts.length)return "\nПРОВЕРКА ОФИЦИАЛЬНОГО ИСТОЧНИКА: онлайн-текст нужных статей Әділет недоступен. "+
    "Не говори, что проверил статьи или сроки по сайту. Покажи официальный URL "+
    source.officialUrl+" и запроси сверку текста и редакции.\n";
  const missing=numbers.filter(n=>!extracts.some(x=>x.article===n));
  return ("\nОНЛАЙН-ИЗВЛЕЧЕНИЕ ИЗ ОФИЦИАЛЬНОЙ ПУБЛИКАЦИИ ӘДІЛЕТ. "+
    "Дата получения страницы: "+asOf+". Это фактически полученный текст, "+
    "НО НЕ ПРОВЕРКА ДАТЫ ВСТУПЛЕНИЯ В СИЛУ И НЕ ИСТОРИЧЕСКАЯ РЕДАКЦИЯ. "+
    "Для событий в прошлом проверь историю и переходные положения. "+
    "Указывай точную статью и официальный URL для каждого извлечённого правила. "+
    "Не утверждай, что URL проверен на другую дату.\n"+
    extracts.map(x=>"СТАТЬЯ "+x.article+"; акт: "+source.title+
      "; официальный адрес: "+source.officialUrl+(x.anchor?"#"+x.anchor:"")+
      "; источник фактической загрузки: "+from+
      "; SHA256: "+x.sha256+"; дата загрузки: "+asOf+
      "; редакция/вступление в силу НЕ подтверждены.\n"+x.text).join("\n\n")+
    (missing.length?"\nНе удалось получить полный текст статей: "+missing.join(", ")+". Не цитировать их как проверенные.":"")
  ).slice(0,15000);
}
