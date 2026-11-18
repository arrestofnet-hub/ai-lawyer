// Small, provenance-first local retrieval. No invented statutes or embedded
// client files. Import only official passages with explicit edition dates.
import fs from "node:fs";

const OFFICIAL_HOSTS=new Set(["adilet.zan.kz","zan.gov.kz","egov.kz","gov.kz","sud.gov.kz"]);
const LANGS=new Set(["ru","kk"]);
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const wordRx=/[\p{L}\p{N}]{3,}/gu;
const STOP=new Set(["для","или","это","как","при","про","что","если","его","она",
  "после","перед","когда","который","согласно","законодательство","казахстан",
  "республики","нужно","надо","подготовь","мне","дело","сроки","ответ"]);
function parseDate(value){
  if(typeof value!=="string"||!ISO_DATE.test(value))throw Error("Invalid legal edition date");
  const d=new Date(value+"T00:00:00Z");
  if(d.toISOString().slice(0,10)!==value)throw Error("Impossible legal edition date");
  return value;
}
export function validateLegalEntry(item){
  if(!item||typeof item!=="object"||Array.isArray(item))throw Error("Legal passage must be object");
  const id=String(item.id||"");
  if(!/^[a-z0-9._:-]{3,100}$/i.test(id))throw Error("Invalid legal passage ID");
  const actTitle=String(item.actTitle||"").trim(),article=String(item.article||"").trim();
  const text=String(item.text||"").trim();
  if(actTitle.length<5||actTitle.length>240||!article||article.length>90)
    throw Error("Legal act and provision are required");
  if(text.length<30||text.length>6500)throw Error("Legal provision size must be 30-6500 characters");
  if(!LANGS.has(item.lang))throw Error("Language must be ru or kk");
  const u=new URL(item.sourceUrl);
  if(u.protocol!=="https:"||u.username||u.password||u.port||
     !OFFICIAL_HOSTS.has(u.hostname.toLowerCase()))
    throw Error("Legal passage must link to an official Kazakhstan HTTPS source");
  const editionDate=parseDate(item.editionDate),checkedAt=parseDate(item.checkedAt);
  const effectiveFrom=parseDate(item.effectiveFrom);
  const effectiveTo=item.effectiveTo?parseDate(item.effectiveTo):null;
  if(effectiveTo&&effectiveTo<effectiveFrom)
    throw Error("Effective-to cannot precede effective-from");
  if(checkedAt<editionDate)throw Error("Checking date must not predate source edition");
  if(!["official","historical"].includes(item.status))
    throw Error("Explicit provenance status required");
  return Object.freeze({
    id,actTitle,article,text,lang:item.lang,sourceUrl:u.href,
    editionDate,checkedAt,effectiveFrom,effectiveTo,status:item.status
  });
}
export function validateLegalCorpus(raw){
  if(!Array.isArray(raw)||raw.length>20000)throw Error("Invalid or oversized legal corpus");
  const ids=new Set();
  const entries=raw.map(validateLegalEntry);
  for(const e of entries){if(ids.has(e.id))throw Error("Duplicate legal ID "+e.id);ids.add(e.id);}
  return entries;
}
export function loadLegalCorpus(filename){
  return validateLegalCorpus(JSON.parse(fs.readFileSync(filename,"utf8")));
}
function tokens(s){return new Set((String(s||"").toLowerCase().match(wordRx)||[])
  .filter(t=>t.length>3&&!STOP.has(t)).slice(0,500));}
export function retrieveLegalPassages(corpus,query,{asOf=null,limit=5,language="ru"}={}){
  const date=asOf===null?new Date().toISOString().slice(0,10):parseDate(asOf);
  const max=Math.min(7,Math.max(1,Number(limit)||5));
  const q=tokens(query);if(!q.size)return [];
  const results=[];
  for(const e of corpus){
    if(e.lang!==language||date<e.effectiveFrom||(e.effectiveTo&&date>e.effectiveTo))continue;
    const headline=tokens(e.actTitle+" "+e.article),body=tokens(e.text);
    let score=0;
    for(const w of q)score+=(headline.has(w)?5:0)+(body.has(w)?1:0);
    if(score>0)results.push({passage:e,score});
  }
  results.sort((a,b)=>b.score-a.score||
    b.passage.editionDate.localeCompare(a.passage.editionDate)||a.passage.id.localeCompare(b.passage.id));
  return results.slice(0,max).map(x=>x.passage);
}
export function buildLegalContext(corpus,query,options={}){
  const matches=retrieveLegalPassages(corpus,query,options);
  if(!matches.length)return "";
  const asOf=options.asOf||new Date().toISOString().slice(0,10);
  return (
    "\nЛОКАЛЬНАЯ ПРАВОВАЯ ВЫБОРКА ПО СОСТОЯНИЮ НА "+asOf+
    ". Отрывки предназначены для поиска, а НЕ гарантируют актуальную редакцию. "+
    "Сверь дату и действие нормы с официальным источником, не придумывай цитаты.\n"+
    matches.map(e=>
      "[Источник "+e.id+"] "+e.actTitle+"; "+e.article+
      "; редакция "+e.editionDate+"; проверено "+e.checkedAt+
      "; действовало "+e.effectiveFrom+" — "+(e.effectiveTo||"дата окончания не указана")+
      "; "+e.sourceUrl+"\nЦИТАТА: "+e.text
    ).join("\n\n")
  ).slice(0,16000);
}
export function legalCorpusStatus(corpus){
  return {passages:corpus.length,officialSources:corpus.filter(e=>e.status==="official").length,
    lastCheckedAt:corpus.map(e=>e.checkedAt).sort().at(-1)||null,
    ready:corpus.length>0};
}
