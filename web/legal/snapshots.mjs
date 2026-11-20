// Audit-first snippets of official legal texts retrieved from the official
// Adilet site. A snapshot is NOT proof of the effective legal edition on a
// historical date and is never silently converted to a verified statute.
import crypto from "node:crypto";
import fs from "node:fs";

const DATE_RX=/^\d{4}-\d{2}-\d{2}$/;
const ACT_RX=/^[KZPSV][A-Za-z0-9_]{6,30}$/;
const ARTICLE_RX=/^Статья \d+(?:-\d+)?\./;
const STOP=new Set(["статья","статьи","статей","кодекс","законом","республики",
  "казахстан","какой","подготовить","нужно","прошу","дело","потому","права",
  "есть","очень","этого","можно","после","данное","этот","мной"]);
function checkedDate(s){
  if(typeof s!=="string"||!DATE_RX.test(s))throw Error("Invalid snapshot capture date");
  const d=new Date(s+"T00:00:00.000Z");
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)
    throw Error("Invalid snapshot capture date");
  return s;
}
function absoluteOfficial(url,hostname,actId){
  if(typeof url!=="string")throw Error("Missing official source URL");
  const u=new URL(url);
  if(u.protocol!=="https:"||u.hostname!==hostname||u.port||u.username||u.password||
     u.pathname!=="/rus/docs/"+actId||u.search||u.hash)
    throw Error("Untrusted official source URL");
  return u.href;
}
export function validateArticleSnapshot(raw,officialRegistry){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    throw Error("Snapshot must be a record");
  const actId=String(raw.actId||"");
  if(!ACT_RX.test(actId)||!officialRegistry.find(x=>x.actId===actId))
    throw Error("Snapshot must refer to known Kazakhstan legal act");
  const canonicalUrl=absoluteOfficial(raw.canonicalUrl,"adilet.zan.kz",actId);
  const capturedFrom=absoluteOfficial(raw.capturedFrom,"old.adilet.zan.kz",actId);
  const snapshotDate=checkedDate(raw.snapshotDate);
  if(raw.provenance!=="official_text_snapshot"||raw.effectiveDateVerified!==false||
     raw.editionDateVerified!==false)
    throw Error("Snapshot may not claim reviewed legal effect or confirmed edition");
  const article=String(raw.article||"");
  const text=String(raw.text||"").trim();
  if(!ARTICLE_RX.test(article)||article.length>200||
    text.length<80||text.length>6500||!text.startsWith(article))
    throw Error("Incomplete, oversized or mismatched article snapshot");
  if(/\nСтатья\s+\d+(?:-\d+)?\./m.test(text.slice(article.length)))
    throw Error("Article snapshot contains multiple articles");
  if(text.includes("\u0000"))throw Error("Invalid article body");
  const id=String(raw.id||"");
  if(!/^[A-Za-z0-9_-]{10,110}$/.test(id)||!id.includes(actId))
    throw Error("Invalid snapshot reference ID");
  return Object.freeze({
    id,actId,article,text,canonicalUrl,capturedFrom,snapshotDate,
    provenance:"official_text_snapshot",editionDateVerified:false,
    effectiveDateVerified:false,
    sha256:crypto.createHash("sha256").update(text,"utf8").digest("hex")
  });
}
export function validateArticleSnapshots(data,officialRegistry){
  if(!Array.isArray(data)||data.length>3000)throw Error("Invalid article snapshots");
  const ids=new Set();
  return data.map(x=>{
    const s=validateArticleSnapshot(x,officialRegistry);
    if(ids.has(s.id))throw Error("Duplicate snapshot ID");
    ids.add(s.id);
    return s;
  });
}
export function loadArticleSnapshots(filepath,officialRegistry){
  return validateArticleSnapshots(JSON.parse(fs.readFileSync(filepath,"utf8")),officialRegistry);
}
function words(s){
  return [...new Set((String(s||"").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[])
    .filter(w=>!STOP.has(w)).slice(0,300))];
}
function extractedCaseDate(q){
  // Conservative temporal guard: if the user references ANY past year or
  // dated event earlier than the capture, don't inject a present-day excerpt.
  const s=String(q||"");
  const years=[...s.matchAll(/(?<!\d)20\d{2}(?!\d)/g)].map(x=>Number(x[0]));
  const iso=[...s.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(x=>x[0]);
  const ru=[...s.matchAll(/\b\d{2}\.\d{2}\.20\d{2}\b/g)].map(x=>{
    const [d,m,y]=x[0].split(".");return y+"-"+m+"-"+d;
  });
  return {years,dates:[...iso,...ru]};
}
export function retrieveArticleSnapshots(snapshots,query,{
  asOf=new Date().toISOString().slice(0,10),limit=4,maxAgeDays=30
}={}){
  checkedDate(asOf);
  const terms=words(query);
  if(!terms.length)return [];
  const dates=extractedCaseDate(query);
  const output=[];
  const age=Number.isFinite(maxAgeDays)?Math.min(90,Math.max(0,maxAgeDays)):30;
  for(const s of snapshots){
    const days=Math.round((Date.parse(asOf)-Date.parse(s.snapshotDate))/86400000);
    if(days<0||days>age||dates.years.some(y=>y<Number(s.snapshotDate.slice(0,4)))||
       dates.dates.some(d=>d<s.snapshotDate))continue;
    const hay=s.text.toLowerCase(),title=s.article.toLowerCase();
    let score=0;
    for(const t of terms)score+=
      (title.includes(t)?6:0)+(hay.includes(t)?1:0);
    if(score>0)output.push({entry:s,score,ageDays:days});
  }
  output.sort((a,b)=>b.score-a.score||
    a.ageDays-b.ageDays||a.entry.id.localeCompare(b.entry.id));
  return output.slice(0,Math.max(1,Math.min(5,Number(limit)||4)))
    .map(x=>({...x.entry,ageDays:x.ageDays}));
}
export function buildArticleSnapshotContext(snapshots,query,options={}){
  const records=retrieveArticleSnapshots(snapshots,query,options);
  if(!records.length)return "";
  const chunks=records.map(x=>
    "[СНИМОК "+x.id+"] "+x.article+"; акт "+x.actId+
    "; выгружено "+x.snapshotDate+" ("+x.ageDays+" дней назад); "+
    "источник: "+x.canonicalUrl+"; сохранённая копия: "+x.capturedFrom+
    "; SHA256 текста: "+x.sha256+"\n"+
    "ВЫДЕРЖКА ИЗ ОФИЦИАЛЬНОЙ СТРАНИЦЫ (НЕ ПОДТВЕРЖДЁННАЯ ИСТОРИЧЕСКАЯ РЕДАКЦИЯ):\n"+x.text
  );
  return (
    "\nВНИМАНИЕ: НИЖЕ ДАТИРОВАННЫЕ СНИМКИ СТАТЕЙ ИЗ ОФИЦИАЛЬНОЙ "+
    "СТРАНИЦЫ ӘДІЛЕТ. Дата выгрузки НЕ равна дате вступления "+
    "в силу статьи. Историческая редакция и действие нормы на "+
    "дату спора НЕ подтверждены. Эти материалы — поисковые "+
    "цитаты с URL, а НЕ самостоятельное доказательство применения "+
    "нормы. Для вывода обязательно проверь через официальный "+
    "источник вступление в силу, поправки, постановления суда и "+
    "переходные положения; при отсутствии проверки так и скажи.\n"+
    chunks.join("\n\n")
  ).slice(0,15500);
}
export function articleSnapshotStatus(snapshots){
  return {snapshotArticles:snapshots.length,
    snapshotLastCapture:snapshots.map(x=>x.snapshotDate).sort().at(-1)||null,
    snapshotEditionsVerified:0};
}
