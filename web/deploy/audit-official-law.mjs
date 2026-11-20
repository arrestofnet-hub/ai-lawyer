#!/usr/bin/env node
// Offline check only. Input must be a separate, complete official HTML-to-
// markdown export, not client materials. Changes REQUIRE legal edition review.
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry} from "../legal/sources.mjs";
import {loadArticleSnapshots} from "../legal/snapshots.mjs";
import {auditSourceSnapshotDrift} from "../legal/snapshot-drift.mjs";

const [actId,file]=process.argv.slice(2);
if(!actId||!file){
  console.error("Usage: node web/deploy/audit-official-law.mjs <official-act-id> <full-official-export.md>");
  process.exitCode=2;
}else{
  const registry=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
  const snapshots=loadArticleSnapshots(
    fileURLToPath(new URL("../legal/source-snapshots.json",import.meta.url)),registry);
  const raw=fs.readFileSync(file,"utf8");
  const result=auditSourceSnapshotDrift(snapshots,actId,raw);
  console.log(JSON.stringify(result,null,2));
  if(result.requiresReview){
    console.error("ATTENTION: official source changed or article missing; requires legal/editorial review. Nothing published.");
    process.exitCode=3;
  }
}
