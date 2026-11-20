// Historical legal evidence: official Әділет archive observations, NOT
// verification that a provision was in legal force on the event date.
// Historical snapshots are selected only from official history links.
// Does not store raw case messages or fetch user-supplied URLs.
import crypto from "node:crypto";
import {selectOfficialSources} from "./sources.mjs";
import {parseOfficialArticles,specificNumbers} from "./live-official.mjs";

const MAX_HTML=5_000_000;
function isoFromDate(s){
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const d=new Date(s+"T00:00:00Z");
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;
  }
  if(!/^\d{2}\.\d{2}\.\d{4}$/.test(s))return null;
  const [day,month,year]=s.split(".");
  return isoFromDate(year+"-"+month+"-"+day);
}
function ddmmyyyy(iso){return iso.slice(8,10)+"."+iso.slice(5,7)+"."+iso.slice(0,4);}
export function historicalDateHint(query,{asOf=new Date().toISOString().slice(0,10)}={}){
  const text=String(query||"");
  const found=new Set();
  for(const m of text.matchAll(/(?<!\d)(?:\d{2}\.\d{2}\.20\d{2}|20\d{2}-\d{2}-\d{2})(?!\d)/g)){
    const date=isoFromDate(m[0]);if(date)found.add(date);
  }
  if(found.size>1)return {historical:true,date:null,reason:"multiple_dates"};
  const dates=[...found];
  if(dates.length&&dates[0]<asOf)return {historical:true,date:dates[0],reason:"dated"};
  if(dates.length)return {historical:false,date:dates[0],reason:"current"};
  const years=[...text.matchAll(/(?<!\d)20\d{2}(?!\d)/g)].map(x=>Number(x[0]));
  if(years.some(y=>y<Number(asOf.slice(0,4))))
    return {historical:true,date:null,reason:"year_without_date"};
  return {historical:false,date:null,reason:"undated"};
}
export function parseOfficialHistory(html,actId){
  if(typeof html!=="string"||html.length<200||html.length>MAX_HTML||
     !/id=["']ethernatable["']/i.test(html))throw Error("Official history table missing");
  if(!/^[A-Z][A-Za-z0-9_]{5,30}$/.test(actId))throw Error("Invalid act");
  const rx=/href=["'](\/rus\/archive\/docs\/[A-Z][A-Za-z0-9_]{5,30}\/\d{2}\.\d{2}\.\d{4})["']/gi;
  const dates=new Set();
  for(const m of html.matchAll(rx)){
    const parts=m[1].split("/");
    if(parts[4]!==actId)continue;
    const d=isoFromDate(parts[5]);if(d)dates.add(d);
  }
  if(dates.size<2||dates.size>400)throw Error("Unreliable official history list");
  return [...dates].sort();
}
export function chooseArchiveRevision(historyDates,eventDate){
  const date=isoFromDate(eventDate);
  if(!date)throw Error("Invalid event date");
  const prior=historyDates.filter(x=>x<=date).at(-1)||null;
  const next=historyDates.find(x=>x>date)||null;
  return {prior,next};
}
async function readOfficialPage(url,fetchImpl){
  const u=new URL(url);
  if(u.protocol!=="https:"||u.hostname!=="old.adilet.zan.kz"||
     u.username||u.password||u.port||u.search||u.hash||
     !/^\/rus\/(?:docs\/[A-Z][A-Za-z0-9_]{5,30}\/history|archive\/docs\/[A-Z][A-Za-z0-9_]{5,30}\/\d{2}\.\d{2}\.\d{4})$/.test(u.pathname))
    throw Error("Untrusted historical source");
  const response=await fetchImpl(url,{method:"GET",redirect:"error",
    headers:{accept:"text/html,application/xhtml+xml"},
    signal:AbortSignal.timeout(7000)});
  if(!response.ok||!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type")||""))
    throw Error("Official historical page unavailable");
  if(Number(response.headers.get("content-length")||0)>MAX_HTML||!response.body)
    throw Error("Oversized or empty historical page");
  const parts=[];let bytes=0;
  for await(const chunk of response.body){
    bytes+=chunk.byteLength;
    if(bytes>MAX_HTML){await response.body.cancel().catch(()=>{});throw Error("Historical page too large");}
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts).toString("utf8");
}
export async function getHistoricalOfficialContext(officialRegistry,query,{
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10)
}={}){
  const hint=historicalDateHint(query,{asOf});
  if(!hint.historical||process.env.LIVE_OFFICIAL_LAW_ENABLED==="0")
    return {historical:false,context:""};
  const source=selectOfficialSources(officialRegistry,query,{max:3})
    .find(x=>specificNumbers(query,x).length);
  if(!source)return {historical:true,context:
    "\nИСТОРИЧЕСКИЙ ПРАВОВОЙ ВОПРОС. Нужный акт/статья не определены по каталогу. "+
    "Не применять сегодняшние выдержки как право на дату события.\n"};
  const numberList=specificNumbers(query,source);
  const caution="\nВНИМАНИЕ: выбранная дата архивной редакции на «Әділет» — дата изменения/состояния текста, "+
    "НЕ подтверждение даты вступления отдельных поправок в силу. Проверяй изменяющий закон, "+
    "его официальную публикацию, переходные положения и возможную обратную силу. "+
    "НЕ утверждай, что архивная статья действовала на дату события, пока эти сведения не сверены.\n";
  if(!hint.date)return {historical:true,context:
    "\nВ вопросе несколько дат либо указан только год. Требуется юридически значимая дата "+
    "для выбора исторической редакции. Сегодняшний текст НЕ применять к прошлому делу без проверки. "+
    "История документа: "+source.historyUrl+"."+caution};
  let dates,archivePage,revision;
  try{
    const historyUrl="https://old.adilet.zan.kz/rus/docs/"+source.actId+"/history";
    const history=await readOfficialPage(historyUrl,fetchImpl);
    dates=parseOfficialHistory(history,source.actId);
    revision=chooseArchiveRevision(dates,hint.date);
    if(!revision.prior)throw Error("No earlier version");
    const archiveUrl="https://old.adilet.zan.kz/rus/archive/docs/"+
      source.actId+"/"+ddmmyyyy(revision.prior);
    archivePage={url:archiveUrl,html:await readOfficialPage(archiveUrl,fetchImpl)};
  }catch{
    return {historical:true,context:
      "\nИСТОРИЧЕСКАЯ ПРОВЕРКА НЕ ЗАВЕРШЕНА: не удалось получить историю и архив Әділет для "+
      source.title+" на дату "+hint.date+". Не подменяй архив сегодняшней редакцией. "+
      "История: "+source.historyUrl+"."+caution};
  }
  let articles=[];
  try{articles=parseOfficialArticles(archivePage.html,numberList);}
  catch{ /* Older HTML revisions need distinct parser review, not guesswork. */ }
  const missing=numberList.filter(n=>!articles.some(x=>x.article===n));
  if(!articles.length)return {historical:true,context:
    "\nАРХИВ ОФИЦИАЛЬНОГО ЗАКОНА НАЙДЕН, НО ТЕКСТ ТРЕБУЕМЫХ СТАТЕЙ НЕ ИЗВЛЕЧЁН. "+
    "Событие: "+hint.date+"; архив: "+archivePage.url+". "+
    "Не цитировать неполные или современные нормы как исторические."+caution};
  const notes=articles.map(x=>{
    const sha=crypto.createHash("sha256").update(x.text,"utf8").digest("hex");
    return "СТАТЬЯ "+x.article+"; архив Әділет: "+archivePage.url+
      (x.anchor?"#"+x.anchor:"")+"; дата выбранной архивной версии: "+revision.prior+
      "; SHA256: "+sha+"; действие на дату события НЕ ПРОВЕРЕНО.\n"+x.text;
  }).join("\n\n");
  return {historical:true,context:(
    "\nАРХИВНЫЕ ТЕКСТЫ ИЗ ИСТОРИИ ИЗМЕНЕНИЙ ӘДІЛЕТ; дата события: "+hint.date+
    "; архивная дата не позже события: "+revision.prior+
    (revision.next?"; следующая указанная архивная дата: "+revision.next:"")+
    "; история: "+source.historyUrl+".\n"+caution+"\n"+notes+
    (missing.length?"\nНе получены архивные статьи: "+missing.join(", ")+".":"")
  ).slice(0,15000)};
}
