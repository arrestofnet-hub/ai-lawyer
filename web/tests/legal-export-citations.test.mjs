import test from "node:test";
import assert from "node:assert/strict";
import {exportPdf,exportDocx} from "../export.mjs";
import {parseLegalMarkdown,plainLegalText} from "../format.mjs";
import {officialExportReferences} from "../legal/export-references.mjs";
import {strategyInstruction} from "../core.mjs";

const modelAnswer=[
  "# Проект заявления",
  "Мною [указать сведения об основном обращении в суд].",
  "Основание: подпункт 6) части 1 статьи 156 ГПК РК.",
  "Статья 157 ГПК — порядок рассмотрения заявления.",
  "Статья 158 ГПК — исполнение определения суда.",
  "Судебный срок указан в статье 364 ГПК.",
  "Статья 92-8 Закона РК «О нотариате» в редакции Закона № 343-VIII.",
  "Нормативное постановление Верховного Суда Республики Казахстан № 6 от 26.05.2022.",
  "",
  "---",
  "## ПРОШУ СУД:",
  "1. Приостановить взыскание.",
  "2. Направить определение для исполнения."
].join("\n");
test("recognized legal citations become whitelisted official document references",()=>{
  const refs=officialExportReferences(modelAnswer,[
    {url:"https://evil.invalid/track?user=secret",title:"Untrusted"},
    {url:"https://old.adilet.zan.kz/rus/docs/K1500000377#z156",title:"Official source"},
  ]);
  assert.ok(refs.length>=7);
  assert.ok(refs.some(x=>x.label.includes("статья 156")));
  assert.ok(refs.some(x=>x.label.includes("статья 157")));
  assert.ok(refs.some(x=>x.label.includes("статья 158")));
  assert.ok(refs.some(x=>x.url.includes("P220000006S")));
  assert.ok(refs.some(x=>x.url.includes("Z2600000343")));
  assert.ok(refs.every(x=>x.url.startsWith("https://old.adilet.zan.kz/rus/docs/")));
  assert.ok(refs.every(x=>!x.url.includes("evil")));
});
test("blank source text cannot fabricate case-specific official citations",()=>{
  assert.deepEqual(officialExportReferences("Добрый день!"),[]);
  assert.deepEqual(officialExportReferences("ГПК упомянут без статьи и контекста"),[]);
});
test("markdown thematic separator becomes a layout rule, not literal lines",()=>{
  const blocks=parseLegalMarkdown(modelAnswer);
  assert.equal(blocks.filter(x=>x.kind==="rule").length,1);
  const plain=plainLegalText(modelAnswer);
  assert.ok(!plain.includes("\n---\n"));
});
test("court draft safety prompt forbids unproven filings and requires article links",()=>{
  const system=strategyInstruction("Применяй законодательство РК","draft");
  assert.match(system,/НЕ утверждай, что заявление, жалоба, иск или ходатайство уже поданы/);
  assert.match(system,/прямой HTTPS-адрес конкретного акта на Әділет/);
});
test("exported PDF includes interactive official links instead of only plain text",async()=>{
  const pdf=await exportPdf(modelAnswer);
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  assert.match(pdf.toString("latin1"),/\/URI\b/);
  assert.match(pdf.toString("latin1"),/adilet\.zan\.kz/);
  const word=await exportDocx(modelAnswer);
  assert.equal(word.subarray(0,2).toString(),"PK");
});
