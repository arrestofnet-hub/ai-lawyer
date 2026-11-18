#!/usr/bin/env node
// Local-only admin import of a manually reviewed OFFICIAL Kazakhstan law corpus.
// Do not fetch URLs here: external sources must be reviewed first. Never
// import raw client chat records or any PII.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {validateLegalCorpus,legalCorpusStatus} from "../legal/norms.mjs";

const source=process.argv[2];
if(!source||source==="--help"){
  console.log("Usage: node web/deploy/import-legal-corpus.mjs /root/reviewed-kz-provisions.json [--check-only]");
  console.log("Each record must contain id,actTitle,article,text,lang,sourceUrl,editionDate,checkedAt,effectiveFrom,effectiveTo,status.");
  process.exitCode=source?0:2;
}else{
  const checkOnly=process.argv.includes("--check-only");
  const target=process.env.LEGAL_CORPUS_FILE||
    path.join(process.env.DATA_DIR||"/var/lib/ai-lawyer-web","legal-corpus.json");
  const buffer=fs.readFileSync(source);
  if(buffer.length>15*1024*1024)throw Error("Corpus is too large for pilot (15 MB maximum)");
  const entries=validateLegalCorpus(JSON.parse(buffer.toString("utf8")));
  const serialized=JSON.stringify(entries,null,2)+"\n";
  const status=legalCorpusStatus(entries);
  const sha256=crypto.createHash("sha256").update(serialized).digest("hex");
  console.log(JSON.stringify({passages:status.passages,officialSources:status.officialSources,
    lastCheckedAt:status.lastCheckedAt,sha256,checkOnly}));
  if(!checkOnly){
    if(!entries.length)throw Error("Refusing to replace a live corpus with an empty list");
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    // No update if the target is a symlink or a directory.
    if(fs.existsSync(target)&&!fs.lstatSync(target).isFile())
      throw Error("Target is not a regular file");
    const tmp=target+".tmp-"+process.pid;
    try{
      fs.writeFileSync(tmp,serialized,{flag:"wx",mode:0o600});
      if(fs.existsSync(target)){
        const backup=target+".bak-"+new Date().toISOString().replace(/[:.]/g,"-");
        fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);
        fs.chmodSync(backup,0o600);
        console.log("Previous corpus backed up to "+backup);
      }
      fs.renameSync(tmp,target);
    }finally{
      try{fs.unlinkSync(tmp);}catch(e){if(e.code!=="ENOENT")throw e;}
    }
    console.log("SUCCESS: official-law corpus imported. Restart ai-lawyer-web to load it.");
  }
}
