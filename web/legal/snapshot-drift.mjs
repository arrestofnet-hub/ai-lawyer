// Compare an independently obtained current official-page export against
// stored source snippets. Never replace the live corpus without review.
import crypto from "node:crypto";

const hash=text=>crypto.createHash("sha256").update(text,"utf8").digest("hex");
const HEADING=/^Статья\s+(\d+(?:-\d+)?)\.\s*([^\n]{0,180})/gm;
function extractPageArticles(markdown){
  if(typeof markdown!=="string"||markdown.length<100)
    throw Error("Provide complete official text, not a search snippet");
  const text=markdown.replace(/\r\n?/g,"\n");
  const heads=[...text.matchAll(HEADING)],items=new Map();
  for(let i=0;i<heads.length;i++){
    const h=heads[i];
    // Some official HTML exports include contents before the legal text.
    // Prefer the last occurrence only, and refuse ambiguous article bodies.
    let body=text.slice(h.index,i+1<heads.length?heads[i+1].index:text.length).trim();
    body=body.split(/\n(?:###\s+(?:Глава|РАЗДЕЛ|Параграф|Подраздел)\b)/)[0].trim();
    if(body.length>=80&&body.length<=6500&&
       !/\nСтатья\s+\d+(?:-\d+)?\./m.test(body.slice(h[0].length)))
      items.set(h[1],body);
  }
  return items;
}
export function auditSourceSnapshotDrift(snapshots,actId,officialMarkdown){
  const records=snapshots.filter(x=>x.actId===actId);
  if(!records.length)throw Error("No snapshots for this act");
  const articles=extractPageArticles(officialMarkdown);
  const results=[];
  for(const saved of records){
    const n=saved.article.match(/^Статья (\d+(?:-\d+)?)\./)?.[1];
    if(!n)throw Error("Corrupt source snapshot heading");
    const current=articles.get(n);
    const status=!current?"cannot_verify":hash(current)===saved.sha256?"unchanged":"changed";
    results.push({snapshotId:saved.id,article:n,status,
      previousHash:saved.sha256,currentHash:current?hash(current):null});
  }
  return {actId,comparedArticles:results.length,unchanged:results.filter(x=>x.status==="unchanged").length,
    changed:results.filter(x=>x.status==="changed").length,
    cannotVerify:results.filter(x=>x.status==="cannot_verify").length,
    requiresReview:results.some(x=>x.status!=="unchanged"),
    autoPublish:false,articles:results};
}
