import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry,selectOfficialSources,sourcePointerContext}
 from "../legal/sources.mjs";
import {strategyInstruction} from "../core.mjs";

const registry=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
const methods=fs.readFileSync(fileURLToPath(new URL("../strategy/LEGAL_PRACTICE_METHODS_V3.md",import.meta.url)),"utf8");
const get=(q)=>selectOfficialSources(registry,q,{max:8}).map(x=>x.id);

test("all six core procedural and substantive codes (ГК ГПК АППК КоАП УК УПК) have trusted entries",()=>{
  for(const id of ["gk-general","gk-special","gpk","appk","koap","uk","upk"])
    assert.ok(registry.find(x=>x.id===id),"missing "+id);
  assert.ok(get("КоАП").includes("koap"));
  assert.ok(!get("КоАП").includes("appk"),"do not conflate administrative offense and administrative litigation");
  assert.ok(get("АППК").includes("appk"));
  assert.ok(get("УК").includes("uk"));
  assert.ok(get("УПК").includes("upk"));
  assert.ok(get("ГПК").includes("gpk"));
  assert.ok(get("ГК").includes("gk-general")&&get("ГК").includes("gk-special"));
});

test("Constitution 2026 is the default, 1995 is excluded from current-only constitutional queries",()=>{
  assert.ok(get("Конституция").includes("constitution-2026"));
  assert.ok(!get("Конституция").includes("constitution-1995"));
  assert.ok(get("Конституция 2025").includes("constitution-1995"));
  const current=sourcePointerContext(registry,"Конституция",{max:8});
  assert.match(current,/K2600000000/);
  assert.doesNotMatch(current,/K950001000_/);
  assert.match(current,/01.07.2026/);
});

test("catalogue includes curated court explanations, Constitutional Court acts and explicit amendment instruments",()=>{
  const id=new Set(registry.map(x=>x.id));
  for(const x of ["np-notarial-inscription","np-enforcement","np-fraud",
    "np-civil-procedure","np-civil-costs","np-administrative-judgment",
    "np-administrative-procedure-2026","np-upk-art106",
    "cc-appk-2024","cc-upk-2026",
    "amend-koap-2025","amend-np-civil-procedure-2025","amend-np-upk-2026"])
    assert.ok(id.has(x),"missing court ruling or amendment: "+x);
  assert.ok(get("статья 106 УПК").includes("np-upk-art106"));
  assert.ok(get("статья 106 УПК").includes("upk"));
  assert.ok(get("оспаривание исполнительной надписи").includes("np-notarial-inscription"));
  assert.ok(registry.every(x=>x.reviewState==="catalogue_only"&&!x.lawTextVerified));
});

test("practical method synthesizes reusable general prompts but never embeds client private details",()=>{
  assert.match(methods,/5–7/); 
  assert.match(methods,/УПК/);
  assert.match(methods,/Конституцион/);
  assert.match(methods,/судьи|судья|судей|судья/iu);
  assert.match(methods,/персональн|ИИН/);
  const instruction=strategyInstruction(methods,"strategy");
  assert.match(instruction,/следующий законный шаг/);
  assert.match(instruction,/источник/);
  assert.match(instruction,/Не выдумывай|не придумывай|не подставлять/iu);
});
