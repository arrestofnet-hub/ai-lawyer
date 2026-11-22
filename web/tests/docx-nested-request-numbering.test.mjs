import test from "node:test";
import assert from "node:assert/strict";
import {numberedExportBlocks,plainLegalText} from "../format.mjs";
import {exportDocx} from "../export.mjs";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const sample=[
  "## МОТИВИРОВАННЫЕ ВОЗРАЖЕНИЯ",
  "1. Не подтверждён переход права требования.",
  "2. Передача пени не доказана.",
  "3. Платёж 180 000 тенге требует проверки.",
  "4. Уведомление не заменяет доказательства уступки.",
  "ПРОШУ:",
  "1. Предоставить доказательства права Компании Б, включая:",
  "• полный подписанный текст соглашения;",
  "• надлежаще оформленный реестр;",
  "• подтверждение полномочий подписантов;",
  "• подтверждение поступления покупной цены;",
  "• подтверждение включения пени.",
  "1. Предоставить проверяемый расчёт задолженности.",
  "2. По результатам проверки направить мотивированный ответ."
].join("\n");

test("PРОШУ starts a new numbering context and bullets remain nested within item 1",()=>{
  const blocks=numberedExportBlocks(sample);
  assert.deepEqual(blocks.filter(b=>b.kind==="ordered").map(b=>b.numbers),
    [[1,2,3,4],[1],[2,3]]);
  const result=plainLegalText(sample);
  assert.match(result,/ПРОШУ:\n\n1\. Предоставить доказательства/);
  assert.match(result,/2\. Предоставить проверяемый расчёт/);
  assert.match(result,/3\. По результатам проверки направить мотивированный ответ/);
  assert.ok(!result.includes("1. Предоставить проверяемый расчёт"));
});
test("non-nested list resets at an actual structural heading, not at an intervening explanation",()=>{
  const text=[
    "1. Сначала уточнить реквизиты.",
    "Это пояснение к первому действию.",
    "• доказательство;",
    "1. Затем получить ответ.",
    "## Отдельный предмет вопроса",
    "1. Новое самостоятельное действие."
  ].join("\n");
  assert.deepEqual(numberedExportBlocks(text).filter(b=>b.kind==="ordered").map(b=>b.numbers),
    [[1],[2],[1]]);
});
test("Word export preserves top-level request numbering and grouped official hyperlinks",async()=>{
  const text=sample+
    "\n\nСтатьи 339, 341, 342, 343, 345, 346 ГК РК. Статья 72 ГПК РК. "+
    "Действие редакции в марте 2025 года не подтверждено.";
  const buf=await exportDocx(text);
  assert.equal(buf.subarray(0,2).toString(),"PK");
  const dir=mkdtempSync(join(tmpdir(),"ai-lawyer-docx-"));
  try{
    const path=join(dir,"test.docx");writeFileSync(path,buf);
    const docXml=execFileSync("unzip",["-p",path,"word/document.xml"],{maxBuffer:4*1024*1024}).toString();
    assert.match(docXml,/2\. Предоставить проверяемый расчёт/);
    assert.match(docXml,/3\. По результатам проверки направить мотивированный ответ/);
    assert.match(docXml,/w:keepNext/);
    assert.match(docXml,/Официальные источники для сверки редакции/);
    const rel=execFileSync("unzip",["-p",path,"word/_rels/document.xml.rels"]).toString();
    assert.match(rel,/K940001000_/);
    assert.match(rel,/K1500000377/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
