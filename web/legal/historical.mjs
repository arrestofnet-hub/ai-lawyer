// Historical legal evidence: official Әділет archive observations, NOT
// verification that a provision was in legal force on the event date.
// Historical snapshots are selected only from official history links.
// Does not store raw case messages or fetch user-supplied URLs.
import crypto from "node:crypto";
import {selectProvisionSources} from "./sources.mjs";
import {parseOfficialArticles,specificNumbers,isCivilAssignmentQuestion} from "./live-official.mjs";
import {buildAmendmentReviewContext} from "./amendment-review.mjs";
import {getPublicationReviewContext} from "./publication.mjs";

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
  if(typeof html!=="string"||html.length<200||html.length>MAX_HTML)
    throw Error("Invalid official history page");
  if(!/^[A-Z][A-Za-z0-9_]{5,30}$/.test(actId))throw Error("Invalid act");
  const hasTableId=/id=["']ethernatable["']/i.test(html);
  // The official 1994 GK history page has also been observed with a
  // plain row-based "История изменений" table after HTML normalization:
  // № | Заголовок | Форма НПА | Официальная публикация |
  // Дата изменения | Статус НПА. Requiring only ethernatable + hrefs
  // wrongly rejects these legitimate date rows.
  const isGkHistory=actId==="K940001000_"&&
    /Гражданский кодекс Республики Казахстан/i.test(html)&&
    /(?:27 декабря 1994 года|268-XIII)/i.test(html)&&
    /История изменений/i.test(html)&&/<table\b/i.test(html);
  if(!hasTableId&&!isGkHistory)throw Error("Official history table missing");
  const rx=/href=["'](\/rus\/archive\/docs\/[A-Z][A-Za-z0-9_]{5,30}\/\d{2}\.\d{2}\.\d{4})["']/gi;
  const dates=new Set();
  for(const m of html.matchAll(rx)){
    const parts=m[1].split("/");
    if(parts[4]!==actId)continue;
    const d=isoFromDate(parts[5]);if(d)dates.add(d);
  }
  if(dates.size<2&&isGkHistory){
    // Extract dates only from rows unambiguously identifying the 1994 GK,
    // never from arbitrary dates in the page or the title/footer.
    for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m=>m[1].replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ")
          .replace(/\s+/g," ").trim());
      if(cells.length<6||!/Гражданский кодекс Республики Казахстан/i.test(cells[1])||
         !/27 декабря 1994 года/i.test(cells[2]))continue;
      const d=isoFromDate(cells[4]);if(d)dates.add(d);
    }
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
    signal:AbortSignal.timeout(url.includes("K940001000_")?16000:7000)});
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
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10),publicationReview=true
}={}){
  const hint=historicalDateHint(query,{asOf});
  if(!hint.historical||process.env.LIVE_OFFICIAL_LAW_ENABLED==="0")
    return {historical:false,context:""};
  const source=(isCivilAssignmentQuestion(query)?
    officialRegistry.find(x=>x.id==="gk-general"):null)||
    selectProvisionSources(officialRegistry,query,{max:3})
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
  // Optional comparison with the closest following official archived revision.
  // Its date is a DOCUMENT EDIT DATE, not a legal effective date.
  let nextHtml=null,nextArticles=[];
  if(revision.next&&revision.next<=asOf&&
      process.env.AMENDMENT_REVIEW_ENABLED!=="0"){
    try{
      const url="https://old.adilet.zan.kz/rus/archive/docs/"+
        source.actId+"/"+ddmmyyyy(revision.next);
      nextHtml=await readOfficialPage(url,fetchImpl);
      nextArticles=parseOfficialArticles(nextHtml,numberList);
    }catch{ nextHtml=null;nextArticles=[]; }
  }
  const review=buildAmendmentReviewContext({
    actId:source.actId,articleNumbers:numberList,eventDate:hint.date,
    priorDate:revision.prior,nextDate:revision.next,
    priorHtml:archivePage.html,priorArticles:articles,nextHtml,nextArticles
  });
  let publicationContext="";
  if(publicationReview){
    try{
      publicationContext=await getPublicationReviewContext({
        actId:source.actId,articleNumbers:numberList,priorHtml:archivePage.html,
        fetchImpl,asOf
      });
    }catch{
      publicationContext="\nПроверка первой официальной публикации не выполнена;"+
        " не заявлять о подтверждённой дате вступления поправок в силу.";
    }
  }
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
    "; история: "+source.historyUrl+".\n"+caution+"\n"+notes+"\n"+review.context+"\n"+publicationContext+
    (missing.length?"\nНе получены архивные статьи: "+missing.join(", ")+".":"")
  ).slice(0,15000)};
}


// For assignment disputes several events may occur on either side of
// an official amendment-history date. Read every relevant event date (up to
// six), but only fetch each DISTINCT archived edition once. This avoids
// comparing only the last two dates and silently omitting the agreement.
export async function getCivilAssignmentArchiveTimeline(officialRegistry,query,{
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10)
}={}){
  if(!isCivilAssignmentQuestion(query)||process.env.LIVE_OFFICIAL_LAW_ENABLED==="0")
    return null;
  const all=[...new Set([...String(query).matchAll(
    /(?<!\d)(?:\d{2}\.\d{2}\.20\d{2}|20\d{2}-\d{2}-\d{2})(?!\d)/g
  )].map(m=>isoFromDate(m[0])).filter(date=>date&&date<=asOf))].sort();
  if(all.length<2)return null;
  const dates=all.slice(0,6),skipped=all.slice(6);
  const source=officialRegistry.find(x=>x.id==="gk-general"&&x.actId==="K940001000_");
  if(!source)return null;
  const actId=source.actId;
  const historyUrl="https://old.adilet.zan.kz/rus/docs/"+actId+"/history";
  const warning="\nПРАВОВОЕ ОГРАНИЧЕНИЕ: дата архивной версии Әділет отражает "+
    "изменение текста, а НЕ удостоверяет дату вступления каждой поправки "+
    "в силу и её применение к прошлым правоотношениям. Для окончательного "+
    "заключения проверить изменяющие законы, официальные публикации, "+
    "исключения, переходные положения и возможную обратную силу.\n";
  let history,observations;
  try{
    history=parseOfficialHistory(await readOfficialPage(historyUrl,fetchImpl),actId);
    observations=dates.map(date=>({
      eventDate:date,...chooseArchiveRevision(history,date)
    }));
    if(observations.some(x=>!x.prior))throw Error("Missing prior archive");
  }catch{
    return {historical:true,comparedDates:dates,otherDates:skipped,context:
      "\nПРОВЕРКА АРХИВОВ ГК ПО ДАТАМ СОБЫТИЙ НЕ ЗАВЕРШЕНА. "+
      "Не подменять редакции сегодняшним текстом. "+
      "Нужная официальная история: "+historyUrl+
      "; рассматриваемые даты: "+dates.join(", ")+warning};
  }
  const articlesWanted=["339","341","342","343","345","346"];
  const editionDates=[...new Set(observations.map(x=>x.prior))];
  const editions=await Promise.all(editionDates.map(async date=>{
    const url="https://old.adilet.zan.kz/rus/archive/docs/"+actId+"/"+
      ddmmyyyy(date);
    try{
      const page=await readOfficialPage(url,fetchImpl);
      const extracted=parseOfficialArticles(page,articlesWanted);
      const missing=articlesWanted.filter(n=>!extracted.some(a=>a.article===n));
      return {date,url,articles:extracted,missing};
    }catch{
      return {date,url,articles:[],missing:articlesWanted};
    }
  }));
  const byEdition=new Map(editions.map(x=>[x.date,x]));
  const aligned=articlesWanted.map(n=>{
    const list=editions.map(e=>e.articles.find(a=>a.article===n)||null);
    return {number:n,list,complete:list.every(Boolean),
      identical:list.every(a=>a&&a.text===list[0]?.text)};
  });
  let context="\nАРХИВНЫЕ РЕДАКЦИИ ГК РК (ОБЩАЯ ЧАСТЬ) ПО СОБЫТИЯМ УСТУПКИ. "+
    "Официальная история: "+historyUrl+
    ". Сопоставлялись события: "+dates.join(", ")+".\n"+
    observations.map(x=>"- Событие "+x.eventDate+": архивная версия "+
      x.prior+(x.next?"; следующая версия "+x.next:"")+
      "; источник "+byEdition.get(x.prior)?.url).join("\n")+"\n"+
    (skipped.length?"Другие даты в вопросе не проверены автоматически: "+
      skipped.join(", ")+".\n":"")+
    warning+
    "\nСТАТЬИ ИЗ ОФИЦИАЛЬНЫХ АРХИВНЫХ ТЕКСТОВ (НЕ ПОДТВЕРЖДЁННЫЕ ПО ДАТЕ ВСТУПЛЕНИЯ В СИЛУ):\n";
  for(const x of aligned){
    if(!x.complete){
      context+="\nСтатья "+x.number+": не извлечена из всех выбранных "+
        "архивных редакций. Нельзя делать вывод о совпадении текстов.\n";
      continue;
    }
    if(x.identical){
      const evidence=editions.map((e,i)=>e.url+
        (x.list[i].anchor?"#"+x.list[i].anchor:"")).join("; ");
      context+="\nСТАТЬЯ "+x.number+
        ": текст совпадает в выбранных архивных версиях ("+
        editionDates.join(", ")+"). Адреса: "+evidence+
        ". SHA256: "+x.list[0].sha256+"\n"+x.list[0].text+"\n";
    }else{
      context+="\nСТАТЬЯ "+x.number+
        ": ТЕКСТЫ РАЗЛИЧАЮТСЯ; отдельно изучи действие каждой поправки.\n";
      for(let i=0;i<editions.length;i++){
        const a=x.list[i],e=editions[i];
        context+="Версия "+e.date+"; URL "+e.url+
          (a.anchor?"#"+a.anchor:"")+
          "; SHA256 "+a.sha256+"\n"+a.text+"\n";
      }
    }
  }
  context+="\nОТДЕЛЬНО ОТ ДОСЛОВНОГО СРАВНЕНИЯ: на даты событий юридическая "+
    "применимость и даты вступления поправок в силу не проверены. "+
    "Указанные источники являются официальными архивными версиями, "+
    "но не заменяют юридической проверки изменяющих законов.";
  return {historical:true,comparedDates:dates,otherDates:skipped,
    archiveDates:editionDates,context:context.slice(0,20500)};
}

// A single case commonly contains several legally distinct dates: the
// notarial act, purported delivery, and later discovery by a bailiff.
// Resolve their possible article editions separately. Never use an arbitrary
// one of those dates as if it represented the entire dispute.
export async function getTimelineOfficialContext(officialRegistry,query,{
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10),
  publicationReview=true
}={}){
  const dates=[...new Set([...String(query).matchAll(/(?<!\d)(?:\d{2}\.\d{2}\.20\d{2}|20\d{2}-\d{2}-\d{2})(?!\d)/g)]
    .map(m=>isoFromDate(m[0])).filter(d=>d&&d<=asOf))].sort();
  if(dates.length<=1)return getHistoricalOfficialContext(officialRegistry,query,{
    fetchImpl,asOf,publicationReview
  });
  const cession=await getCivilAssignmentArchiveTimeline(officialRegistry,query,{
    fetchImpl,asOf
  });
  if(cession)return cession;
  // Two dates are the normal case; limit automatic source reads and clearly
  // flag unselected dates instead of silently treating them as irrelevant.
  const targets=dates.slice(-2);
  const skipped=dates.filter(d=>!targets.includes(d));
  const stripped=String(query).replace(/(?<!\d)(?:\d{2}\.\d{2}\.20\d{2}|20\d{2}-\d{2}-\d{2})(?!\d)/g," ");
  // Multiple timelines often request the same history page/amending acts.
  // Share only in-flight official HTTP responses; no personal questions,
  // case texts or server state are cached.
  const inflight=new Map();
  const dedup=(url,opts)=>{
    if(!inflight.has(url))inflight.set(url,Promise.resolve(fetchImpl(url,opts)));
    return inflight.get(url).then(response=>response.clone());
  };
  const results=await Promise.all(targets.map((date,i)=>
    getHistoricalOfficialContext(officialRegistry,
      stripped+"; требуются статьи применительно к дате "+ddmmyyyy(date),{
        fetchImpl:dedup,asOf,publicationReview:publicationReview&&i===0
      })
  ));
  const context="\nНЕСКОЛЬКО ЮРИДИЧЕСКИ ВОЗМОЖНЫХ ДАТ. "+
    "Не переносить действие одной редакции на все события. "+
    "Установить роль каждой даты из фактов дела (совершение, направление, "+
    "получение, осведомлённость, процессуальное обращение). "+
    "По двум датам ниже получены отдельные архивные тексты, "+
    "но дата действия каждой нормы юридически НЕ подтверждена.\n"+
    (skipped.length?"Дополнительные даты в вопросе, не выбранные для "+
      "автоматической сверки: "+skipped.join(", ")+
      ". Это не означает отсутствия их юридического значения.\n":"")+
    results.map((r,i)=>"\n=== КАНДИДАТНАЯ ДАТА "+targets[i]+" ===\n"+
      (r.context||"Архивный текст недоступен.").slice(0,8500)).join("\n");
  return {historical:true,context:context.slice(0,19500),
    comparedDates:targets,otherDates:skipped};
}
