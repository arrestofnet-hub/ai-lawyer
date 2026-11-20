import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry,validateOfficialRegistry,validateOfficialSource,
  selectOfficialSources,sourcePointerContext,officialSourceStatus} from "../legal/sources.mjs";
import {stageArticleCandidates} from "../legal/staging.mjs";
import {buildMessages} from "../core.mjs";

const registry=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
test("15 Kazakhstan legal source catalogue records have precise official Adilet URLs and no fake legal text",()=>{
  assert.equal(registry.length,15);
  assert.deepEqual(officialSourceStatus(registry),{
    cataloguedActs:15,catalogOnly:true,lastMetadataCheck:"2026-11-20"
  });
  for(const item of registry){
    assert.equal(item.reviewState,"catalogue_only");
    assert.equal(item.lawTextVerified,false);
    assert.equal(item.officialUrl,
      "https://adilet.zan.kz/rus/docs/"+item.actId);
  }
  assert.throws(()=>validateOfficialRegistry([registry[0],registry[0]]),/Duplicate/);
  assert.throws(()=>validateOfficialSource({
    ...registry[0],officialUrl:"https://evil.invalid/rus/docs/K940001000_"
  }),/Untrusted/);
  assert.throws(()=>validateOfficialSource({...registry[0],lawTextVerified:true}),
    /must not claim/);
});
test("source pointers route legal specialties without pretending statutes have been checked",()=>{
  const chsi=selectOfficialSources(registry,"ЧСИ наложил арест на счета");
  assert.ok(chsi.some(x=>x.id==="enforcement"));
  assert.ok(selectOfficialSources(registry,"ЧСИ").some(x=>x.id==="enforcement"));
  assert.ok(selectOfficialSources(registry,"МФО").some(x=>x.id==="mfo"));
  assert.ok(selectOfficialSources(registry,"ГК").some(x=>x.id==="gk-general"));
  assert.ok(selectOfficialSources(registry,"ГК").some(x=>x.id==="gk-special"));
  assert.ok(selectOfficialSources(registry,"ГПК").some(x=>x.id==="gpk"));
  assert.ok(selectOfficialSources(registry,"Исполнительная надпись нотариуса")
    .some(x=>x.id==="notary"));
  assert.ok(selectOfficialSources(registry,"МФО требует микрокредит")
    .some(x=>x.id==="mfo"));
  assert.ok(selectOfficialSources(registry,"Сверьте начисления КСК и тариф содержания дома")
    .some(x=>x.id==="housing"));
  const modern=selectOfficialSources(registry,"Банк нарушил договор банковского займа в 2026 году");
  assert.ok(modern.some(x=>x.id==="bank-law-2026"));
  assert.ok(!modern.some(x=>x.id==="bank-law-1995"),
    "prior law must not silently appear as a current general bank statute");
  const old=selectOfficialSources(registry,"Банковский кредит 2024, какое законодательство применяется?");
  assert.ok(old.some(x=>x.id==="bank-law-1995"));
  assert.ok(old.find(x=>x.id==="bank-law-1995").transition.includes("01.01.2027"));
  assert.equal(selectOfficialSources(registry,"хочу приготовить ужин").length,0);
  const pointer=sourcePointerContext(registry,"Арест ЧСИ");
  assert.match(pointer,/НЕ ТЕКСТЫ НОРМ/);
  assert.match(pointer,/найди её точный/i);
  assert.match(pointer,/adilet.zan.kz/);
  assert.doesNotMatch(pointer,/\[Источник \w+\] .*ЦИТАТА:/);
  const msg=buildMessages([],"Арест ЧСИ",[],{
    title:"Тест",objective:"",summary:"",mode:"consult",localNormContext:pointer
  });
  assert.ok(msg[0].content.includes("НАВИГАЦИОННЫЕ ССЫЛКИ"));
});
test("stage extracts distinct article candidates only as unpublished drafts and refuses suspicious personal data",()=>{
  const sample=[
    "Титул тестового правового акта.",
    "Статья 1. Общие правила",
    "Настоящая синтетическая норма проверяется редактором и не действует как закон.",
    "Исключение прямо изложено в следующем предложении и не должно пропадать.",
    "Статья 2. Контроль",
    "Данная норма не является настоящим законом и предназначена для проверки разбора статей.",
    "Условие, указание и специальное ограничение."
  ].join("\n");
  const result=stageArticleCandidates(registry[0],sample);
  assert.equal(result.publishable,false);
  assert.equal(result.articles.length,2);
  assert.equal(result.articles[0].editionDate,null);
  assert.equal(result.articles[0].citationAllowed,false);
  assert.equal(result.articles[0].status,"requires_manual_review");
  assert.ok(result.articles[0].text.includes("Исключение"));
  assert.throws(()=>stageArticleCandidates(registry[0],
    "Договор клиента, ИИН 123456789012\n"+sample),/personal identifiers/);
  assert.throws(()=>stageArticleCandidates(registry[0],"Нет заголовков статей"+sample.replaceAll("Статья","Глава")),
    /No explicit/);
});
test("staging command writes reviewed-only output and never overwrites existing draft",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"al-official-law-"));
  const source=path.join(dir,"official.txt");
  const target=path.join(dir,"unreviewed.json");
  const cli=fileURLToPath(new URL("../deploy/stage-official-act.mjs",import.meta.url));
  try {
    fs.writeFileSync(source,"Статья 15. Основания\n"+
      "Этот вымышленный текст нужен исключительно для проверки сохранения условных требований.\n");
    const run=()=>spawnSync(process.execPath,[cli,"enforcement",source,target],{encoding:"utf8"});
    const first=run();
    assert.equal(first.status,0,first.stderr);
    const data=JSON.parse(fs.readFileSync(target,"utf8"));
    assert.equal(data.publishable,false);
    assert.equal(data.articles[0].citationAllowed,false);
    const second=run();
    assert.notEqual(second.status,0,"existing review work must not be overwritten");
    assert.ok(fs.existsSync(target));
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
