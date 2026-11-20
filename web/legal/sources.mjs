// Law metadata pointers, never statute quotations. A catalogue entry only tells
// the model WHERE to verify relevant legal text, not what a provision says.
import fs from "node:fs";
const PATH_RX=/^\/rus\/docs\/([A-Z][A-Za-z0-9_]{5,30})$/;
const ISO=/^\d{4}-\d{2}-\d{2}$/;
function validDate(v){
  if(typeof v!=="string"||!ISO.test(v))throw Error("Invalid metadata checked-at date");
  const d=new Date(v+"T00:00:00Z");
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)
    throw Error("Invalid metadata checked-at date");
  return v;
}
export function validateOfficialSource(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    throw Error("Official source must be a record");
  if(!/^[a-z][a-z0-9-]{2,49}$/.test(raw.id||""))
    throw Error("Invalid official source ID");
  if(typeof raw.title!=="string"||raw.title.trim().length<10||
    raw.title.length>240)throw Error("Official source title required");
  if(typeof raw.actId!=="string"||!PATH_RX.test("/rus/docs/"+raw.actId))
    throw Error("Invalid official act ID");
  const expected="https://adilet.zan.kz/rus/docs/"+raw.actId;
  for(const [field,suffix] of [
    ["officialUrl",""],["historyUrl","/history"],["infoUrl","/info"]
  ])if(raw[field]!==expected+suffix)throw Error("Untrusted official source "+field);
  if(raw.reviewState!=="catalogue_only"||raw.lawTextVerified!==false)
    throw Error("Unverified law catalogue must not claim validated legal text");
  if(raw.language!=="ru")throw Error("Unsupported law catalogue language");
  if(!Array.isArray(raw.keywords)||!raw.keywords.length||raw.keywords.length>30||
     raw.keywords.some(k=>typeof k!=="string"||k.trim().length<3||k.length>60))
    throw Error("Invalid law catalogue keywords");
  if(typeof raw.description!=="string"||raw.description.length<10||
    raw.description.length>320)throw Error("Invalid source description");
  validDate(raw.metadataCheckedAt);
  if(raw.transition!=null&&(typeof raw.transition!=="string"||raw.transition.length>550))
    throw Error("Invalid law transition note");
  return Object.freeze({
    id:raw.id,title:raw.title.trim(),actId:raw.actId,
    officialUrl:raw.officialUrl,infoUrl:raw.infoUrl,historyUrl:raw.historyUrl,
    language:raw.language,keywords:Object.freeze(raw.keywords.map(x=>x.trim().toLowerCase())),
    description:raw.description.trim(),metadataCheckedAt:raw.metadataCheckedAt,
    reviewState:"catalogue_only",lawTextVerified:false,
    ...(raw.transition?{transition:raw.transition.trim()}:{})
  });
}
export function validateOfficialRegistry(data){
  if(!Array.isArray(data)||data.length>1000)throw Error("Invalid source registry");
  const ids=new Set(),acts=new Set();
  return data.map(row=>{
    const result=validateOfficialSource(row);
    if(ids.has(result.id)||acts.has(result.actId))
      throw Error("Duplicate official act or ID");
    ids.add(result.id);acts.add(result.actId);
    return result;
  });
}
export function loadOfficialRegistry(file){
  return validateOfficialRegistry(JSON.parse(fs.readFileSync(file,"utf8")));
}
function normalized(v){return String(v||"").toLowerCase().replace(/ё/g,"е")
  .replace(/\s+/g," ").trim().slice(0,10000);}
const words=raw=>normalized(raw).match(/[\p{L}\p{N}]{3,}/gu)||[];
const STOP=new Set(["закона","законодательства","республики","казахстан","гражданский",
 "кодекс","статья","статьи","суд","срок","вопрос","какой","который","подготовь"]);
export function selectOfficialSources(sources,query,{max=5}={}){
  const text=normalized(query);
  const ws=words(text).filter(x=>x.length>3&&!STOP.has(x));
  if(!ws.length)return [];
  const hits=[];
  for(const entry of sources){
    // The 1995 bank law has a partial repeal: show it only for an explicitly
    // historical question or when the user asks about transition clauses.
    if(entry.id==="bank-law-1995"&&!/1995|202[0-5]|до 2026|стар(ый|ого|ые)|переходн|утратил сил/.test(text))
      continue;
    let score=0;
    for(const keyword of entry.keywords){
      const key=normalized(keyword);
      if(text.includes(key))score+=key.includes(" ")?8:5;
      else if(!key.includes(" ")&&ws.some(w=>w.startsWith(key)))score+=4;
    }
    const name=words(entry.title).filter(x=>x.length>=5&&!STOP.has(x));
    for(const w of ws)if(name.some(n=>n.startsWith(w)&&w.length>=5))score+=0.5;
    if(score>0)hits.push({entry,score});
  }
  hits.sort((a,b)=>b.score-a.score||a.entry.id.localeCompare(b.entry.id));
  return hits.slice(0,Math.max(1,Math.min(8,Number(max)||5))).map(x=>x.entry);
}
export function sourcePointerContext(sources,query,{max=4}={}){
  const hits=selectOfficialSources(sources,query,{max});
  if(!hits.length)return "";
  return (
    "\nОФИЦИАЛЬНЫЕ НАВИГАЦИОННЫЕ ССЫЛКИ ПО ТЕМЕ (НЕ ТЕКСТЫ НОРМ):\n"+
    "Эти записи — только справочник названий актов. Их статьи, редакции, "+
    "переходные положения и применимость НЕ проверены в локальной базе. "+
    "Перед ссылкой на конкретную статью найди её точный действовавший "+
    "на нужную дату текст в официальном источнике. "+
    "Нельзя представлять каталог как правовое доказательство.\n"+
    hits.map((v,i)=>
      (i+1)+". "+v.title+"; акт "+v.actId+"; "+v.officialUrl+
      "; история редакций: "+v.historyUrl+"."+
      (v.transition?" ВНИМАНИЕ: "+v.transition:"")).join("\n")
  ).slice(0,5300);
}
export function officialSourceStatus(sources){
  return {cataloguedActs:sources.length,
    catalogOnly:true,lastMetadataCheck:sources.map(v=>v.metadataCheckedAt).sort().at(-1)||null};
}
