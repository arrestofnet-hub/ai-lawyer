#!/usr/bin/env node
// Offline staging only. NO live server mutation and NO corpus update.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry} from "../legal/sources.mjs";
import {stageArticleCandidates} from "../legal/staging.mjs";

const [actId,file,out]=process.argv.slice(2);
if(!actId||!file||!out){
  console.error("Usage: node web/deploy/stage-official-act.mjs <source-id> <official-text.txt> <out-review.json>");
  console.error("Source IDs are in web/legal/official-sources.json. Output is UNVERIFIED and cannot be loaded by RAG.");
  process.exitCode=2;
}else{
  const catalogue=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
  const entry=catalogue.find(x=>x.id===actId);
  if(!entry)throw Error("Unknown law source ID: "+actId);
  const text=fs.readFileSync(file,"utf8");
  const staged=stageArticleCandidates(entry,text);
  const output=path.resolve(out);
  // No overwrites: old reviewer decisions must remain immutable.
  fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  fs.writeFileSync(output,JSON.stringify(staged,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({source:entry.id,articles:staged.articles.length,
    publishable:staged.publishable,file:output,sourceHash:staged.sourceHash}));
  console.log("REQUIRES_MANUAL_REVIEW: this file is NOT a valid published legal corpus.");
}
