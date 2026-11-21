// Extract candidates from manually exported official text. Every candidate is
// explicitly UNVERIFIED and CANNOT be used by the production legal corpus.
import crypto from "node:crypto";
const HEADING=/^Статья\s+(\d+(?:-\d+)?)\.?\s*([^\r\n]{0,180})\s*$/gmi;
const MAX_INPUT=2*1024*1024;
export function stageArticleCandidates(entry,raw,{maxArticles=80}={}){
  if(entry?.reviewState!=="catalogue_only"||entry.lawTextVerified!==false)
    throw Error("Invalid law source catalogue entry");
  if(typeof raw!=="string"||raw.length>MAX_INPUT||raw.length<30)
    throw Error("Invalid or oversized official legal-text draft");
  // Do not accept likely client information in the shared source staging area.
  if(/(?:\b\d{12}\b)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+7|8)[\s()-]*7\d{2}[\s()-]*\d{3}[\s()-]*\d{2}[\s()-]*\d{2}/iu.test(raw))
    throw Error("Text contains possible personal identifiers; do not import client documents");
  const text=raw.replace(/\r\n?/g,"\n");
  const headings=[...text.matchAll(HEADING)];
  if(!headings.length)throw Error("No explicit 'Статья N' headings found; do not guess provisions");
  const candidates=[];
  const max=Math.min(100,Math.max(1,Number(maxArticles)||80));
  const seen=new Set();
  for(let i=0;i<headings.length&&candidates.length<max;i++){
    const h=headings[i],num=h[1],heading=(h[2]||"").trim();
    const body=text.slice(h.index+h[0].length,
      i+1<headings.length?headings[i+1].index:text.length).trim();
    // Reject too-short/incomplete fragments and enormous chapter bodies; no
    // silent truncation, because that could remove conditions or exceptions.
    if(body.length<30||body.length>6500)continue;
    if(seen.has(num))continue;
    seen.add(num);
    const digest=crypto.createHash("sha256").update(body).digest("hex");
    candidates.push({
      draftId:entry.id+"-article-"+num.replace(/[^0-9-]/g,""),
      actId:entry.actId,actTitle:entry.title,article:"Статья "+num+
        (heading?". "+heading:""),text:body,language:"ru",
      sourceUrl:entry.officialUrl,
      sha256:digest,
      status:"requires_manual_review",citationAllowed:false,
      editionDate:null,effectiveFrom:null,effectiveTo:null,checkedAt:null,
      reviewRequired:[
        "Сравните дословно с официальным текстом «Әділет»",
        "Проверьте дату редакции статьи и вводящие/переходные положения",
        "Проверьте, не является ли данный текст сравнением редакций или утратившей силу нормой",
        "Заполните поля editionDate/effectiveFrom/effectiveTo/checkedAt только после подтверждения"
      ]
    });
  }
  if(!candidates.length)throw Error("No complete candidate articles found; never import partial norms");
  return {actId:entry.actId,stagedAt:new Date().toISOString(),
    sourceHash:crypto.createHash("sha256").update(text).digest("hex"),
    publishable:false,articles:candidates};
}
