// Official publication evidence for amending laws listed in Әділет footnotes.
// This is a source audit, not a legally verified operative date. Exception
// scopes, transitional clauses and subsequent amendments still need review.
import crypto from "node:crypto";
import {extractArticleAmendmentNotes} from "./amendment-review.mjs";

const ACT=/^Z[A-Za-z0-9_]{6,30}$/;
const MAX_PAGE=5_000_000;
function normalizeText(html){
  return String(html).replace(/<br\s*\/?>/gi," ")
    .replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&").replace(/[^\S\n]+/g," ").trim();
}
function iso(s){
  if(!/^\d{2}\.\d{2}\.\d{4}$/.test(s))return null;
  const [d,m,y]=s.split(".");
  const v=y+"-"+m+"-"+d;
  const x=new Date(v+"T00:00:00Z");
  return Number.isFinite(x.getTime())&&x.toISOString().slice(0,10)===v?v:null;
}
export function addDays(ymd,days){
  const date=new Date(ymd+"T00:00:00Z");
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
export function parseOfficialPublicationMetadata(infoHtml,{actId}={}){
  const hasLegacyTable=/id=["']ethernatable["']/i.test(String(infoHtml));
  // Some genuine official Әділет /info pages use an unmarked HTML table.
  // For the 09.04.2025 amending law, require BOTH matching law identity
  // and the specific 179-VIII registration number before trusting such rows.
  const hasIdentifiedModernTable=actId==="Z2500000179"&&
    /О внесении изменений и дополнений[\\s\\S]{0,300}охраны и использования водного фонда/iu.test(infoHtml||"")&&
    /Закон Республики Казахстан от 9 апреля 2025 года №\\s*179-VIII/iu.test(infoHtml||"")&&
    /Регистрационный номер НПА, присвоенный нормотворческим органом/iu.test(infoHtml||"")&&
    /<table\\b/iu.test(infoHtml||"");
  if(!ACT.test(actId||"")||typeof infoHtml!=="string"||infoHtml.length<250||infoHtml.length>MAX_PAGE||
     !(hasLegacyTable||hasIdentifiedModernTable))
    throw Error("Unreliable official publication metadata");
  const rows=[...infoHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
  const publicationRow=rows.find(x=>
    normalizeText(x[0]).includes("Информация об официальном опубликовании акта"));
  if(!publicationRow)throw Error("Official publication evidence missing");
  const tds=[...publicationRow[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
  if(tds.length!==2||!normalizeText(tds[0][1]).startsWith("Информация об официальном опубликовании акта"))
    throw Error("Malformed official publication row");
  const description=normalizeText(tds[1][1]);
  const dates=[...new Set([...description.matchAll(/(?<!\d)\d{2}\.\d{2}\.\d{4}(?!\d)/g)]
    .map(x=>iso(x[0])).filter(Boolean))].sort();
  if(!dates.length)throw Error("No dated publication evidence");
  return {actId,firstReportedPublication:dates[0],reportedDates:dates,
    publicationDetails:description.slice(0,650),
    infoUrl:"https://old.adilet.zan.kz/rus/docs/"+actId+"/info",
    officialMetadata:true,individualGazetteVerified:false,
    metadataSha256:crypto.createHash("sha256").update(description,"utf8").digest("hex")};
}
export function parseAmendingLawEnactment(actHtml,{actId}={}){
  if(!ACT.test(actId||"")||typeof actHtml!=="string"||actHtml.length<500||
     actHtml.length>MAX_PAGE)throw Error("Invalid amending law HTML");
  const body=actHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!body)throw Error("Official law text missing");
  const paragraphs=[...body.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
    .map(m=>({html:m[0],text:normalizeText(m[0]),offset:m.index}));
  // Introductory enactment clause appears at the end of an amending law.
  const matches=paragraphs.map((p,i)=>({p,i}))
    .filter(({p})=>/^Статья\s+(?:2|3)\.\s*(?:Настоящий\s+Закон\s+вводится|$)/iu.test(p.text));
  if(!matches.length)throw Error("Enactment article not reliably located");
  const located=matches.at(-1);
  const heading=located.p.text.match(/^Статья\s+([23])\./u);
  const tail=paragraphs.slice(located.i,located.i+8)
    .filter(p=>!p.text.includes("Президент Республики Казахстан"));
  const excerpt=tail.map(p=>p.text).join("\n");
  if(!/Настоящий\s+Закон\s+вводится\s+в\s+действие/iu.test(excerpt))
    throw Error("No enactment clause in legislative text");
  const baseMatch=excerpt.match(/по\s+истечении\s+([\p{L}]+)\s+календарных\s+дней\s+после\s+дня\s+его\s+первого\s+официального\s+опубликования/iu);
  const spelled={"десяти":10,"шестидесяти":60,"тридцати":30};
  const calendarDays=baseMatch?(spelled[baseMatch[1].toLowerCase()]??null):null;
  const exceptions=tail.map(p=>p.text)
    .filter(x=>/^\s*[1-9]\)\s/u.test(x)||/за\s+исключением/iu.test(x))
    .slice(0,5);
  return {
    actId,article:heading?.[1]||null,calendarDays,exceptionsPresent:/за\s+исключением/iu.test(excerpt),
    exceptionEvidence:exceptions.map(x=>x.slice(0,1400)),
    enactmentExcerpt:excerpt.slice(0,4500),
    lawUrl:"https://old.adilet.zan.kz/rus/docs/"+actId,
    legalApplicabilityVerified:false,
    textSha256:crypto.createHash("sha256").update(excerpt,"utf8").digest("hex")
  };
}
export async function fetchOfficialLaw(url,fetchImpl){
  const u=new URL(url);
  if(u.protocol!=="https:"||u.hostname!=="old.adilet.zan.kz"||u.port||
     u.username||u.password||u.search||u.hash||
     !/^\/rus\/docs\/Z[A-Za-z0-9_]{6,30}(?:\/info)?$/.test(u.pathname))
    throw Error("Untrusted publication URL");
  const response=await fetchImpl(url,{method:"GET",redirect:"error",
    headers:{accept:"text/html,application/xhtml+xml"},
    signal:AbortSignal.timeout(7000)});
  if(!response.ok||!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type")||"")||
     !response.body||Number(response.headers.get("content-length")||0)>MAX_PAGE)
    throw Error("Official publication page unavailable");
  let bytes=0;const chunks=[];
  for await(const chunk of response.body){
    bytes+=chunk.byteLength;
    if(bytes>MAX_PAGE){await response.body.cancel().catch(()=>{});throw Error("Official publication page too large");}
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function getPublicationReviewContext({actId,articleNumbers,priorHtml,
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10)
}={}){
  if(process.env.OFFICIAL_PUBLICATION_REVIEW_ENABLED==="0")return "";
  const notes=extractArticleAmendmentNotes(priorHtml,articleNumbers,{actId});
  const ids=[...new Set(notes.flatMap(x=>x.amendingActIds))]
    .filter(x=>ACT.test(x)).slice(0,2);
  if(!ids.length)return "\nПроверка официального опубликования: изменяющие законы в сносках не установлены.";
  const reports=await Promise.all(ids.map(async id=>{
    try{
      const root="https://old.adilet.zan.kz/rus/docs/"+id;
      const [info,law]=await Promise.all([
        fetchOfficialLaw(root+"/info",fetchImpl),fetchOfficialLaw(root,fetchImpl)
      ]);
      const pub=parseOfficialPublicationMetadata(info,{actId:id});
      const enactment=parseAmendingLawEnactment(law,{actId:id});
      const candidate=enactment.calendarDays===null?null:
        addDays(pub.firstReportedPublication,enactment.calendarDays+1);
      return {id,pub,enactment,candidate,error:null};
    }catch{return {id,error:"official_evidence_incomplete"};}
  }));
  let out="\nОФИЦИАЛЬНЫЕ СВЕДЕНИЯ О ПЕРВОМ ОПУБЛИКОВАНИИ И ВВЕДЕНИИ ПОПРАВОК (ПРЕДВАРИТЕЛЬНЫЕ):"+
    "\nДаты рассчитаны по общей формуле и НЕ подтверждают вступление конкретной поправки в силу."+
    " Обязательно проверить исключения изменяющего закона, применимость подпункта/абзаца,"+
    " переходные нормы, последующие изменения и правила исчисления сроков.";
  for(const r of reports){
    if(r.error){
      out+="\nИзменяющий закон "+r.id+": сведения Әділет недоступны или не распознаны."+
        " Не указывать вычисленную дату вступления в силу.";
      continue;
    }
    out+="\nИзменяющий закон "+r.id+
      ": самая ранняя дата официальной публикации, указанная в метаданных Әділет: "+
      r.pub.firstReportedPublication+
      "; остальные указанные даты: "+r.pub.reportedDates.join(", ")+
      "; источник: "+r.pub.infoUrl+
      "; статья "+r.enactment.article+" о введении в действие: "+r.enactment.lawUrl+
      "; общее правило: "+(r.enactment.calendarDays===null?"не распознано":r.enactment.calendarDays+" календарных дней после первого опубликования")+
      "; ПРЕДВАРИТЕЛЬНАЯ дата по общему правилу: "+(r.candidate||"не вычислена")+
      "; исключения: "+(r.enactment.exceptionsPresent?"ПРЕДУСМОТРЕНЫ, применимость НЕ проверена":"не обнаружены в распознанном тексте")+
      "; индивидуальная газетная публикация отдельно НЕ проверена;"+
      " юридическая дата действия конкретной поправки НЕ ПОДТВЕРЖДЕНА.";
    if(r.enactment.exceptionEvidence.length)
      out+="\nТекст общего правила и исключений (официальная публикация): "+
      r.enactment.exceptionEvidence.join(" ").slice(0,1500);
  }
  return out.slice(0,9500);
}
