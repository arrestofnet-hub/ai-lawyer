import test from "node:test";
import assert from "node:assert/strict";
import {
  uncertainPaymentSignals,buildLayIntakeContext,qualifyUncertainPaymentDraft
} from "../legal/issue-intake.mjs";
import {numberedExportBlocks,plainLegalText} from "../format.mjs";
import {officialExportReferences} from "../legal/export-references.mjs";
import {exportPdf,exportDocx} from "../export.mjs";

const question="У меня Каспи заблокировали, судебник говорит должен микрофинансовой компании. Я вроде давно платил, но не помню сколько. Никаких бумаг из суда не получал.";
const answer=[
  "## 1. Что сделать сегодня",
  "1. Напишите в поддержку Kaspi:",
  "Попросите уточнить основание: арест, платёжное требование или иное ограничение.",
  "1. Запросите материалы исполнительного производства у ЧСИ.",
  "2. Сохраните историю платежей.",
  "",
  "## 2. Образец заявления",
  "Мне стало известно об ограничении банковского счёта.",
  "Ранее я производил платежи по обязательству.",
  "Прошу предоставить копию исполнительного документа.",
  "",
  "Официальные акты: Закон об исполнительном производстве, ГПК, Закон «О нотариате»."
].join("\n");

test("uncertain colloquial payment is classified differently from confirmed payment",()=>{
  const s=uncertainPaymentSignals(question);
  assert.deepEqual(s,{paymentMentioned:true,existenceUncertain:true,amountUncertain:true});
  assert.equal(uncertainPaymentSignals("Я точно оплатил 15000 тенге по чеку").existenceUncertain,false);
  assert.equal(uncertainPaymentSignals("Не помню сколько платил").existenceUncertain,false);
  const ctx=buildLayIntakeContext(question);
  assert.match(ctx,/НЕЛЬЗЯ писать от первого лица как установленный факт/);
  assert.match(ctx,/не упоминай внутренние тесты/);
});
test("unverified user payment cannot be exported as unconditional affidavit in the known phrase",()=>{
  const text=qualifyUncertainPaymentDraft(question,answer);
  assert.doesNotMatch(text,/Ранее я производил платежи по обязательству/);
  assert.match(text,/По моим предварительным сведениям, ранее по обязательству могли производиться платежи/);
  assert.match(text,/суммы и учёт/);
  const certain=qualifyUncertainPaymentDraft("По чеку я оплатил долг",answer);
  assert.equal(certain,answer);
});
test("plain-language answer with vague statute titles receives only act-level official links",()=>{
  const refs=officialExportReferences(answer);
  assert.deepEqual(refs.map(x=>x.url),[
    "https://old.adilet.zan.kz/rus/docs/K1500000377",
    "https://old.adilet.zan.kz/rus/docs/Z100000261_",
    "https://old.adilet.zan.kz/rus/docs/Z970000155_"
  ]);
  assert.ok(refs.every(x=>!x.label.includes("статья")));
  assert.ok(refs.every(x=>x.label.includes("общий")||x.label.includes("официальный")));
});
test("repeated one, one, two becomes one, two, three even across advice paragraph",()=>{
  const lists=numberedExportBlocks(answer).filter(b=>b.kind==="ordered");
  assert.deepEqual(lists.map(b=>b.numbers),[[1],[2,3]]);
  const text=plainLegalText(answer);
  assert.match(text,/1\. Напишите в поддержку Kaspi/);
  assert.match(text,/2\. Запросите материалы/);
  assert.match(text,/3\. Сохраните историю/);
});
test("old answer can be re-exported with three source links without new model tokens",async()=>{
  const revised=qualifyUncertainPaymentDraft(question,answer);
  const pdf=await exportPdf(revised);
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  assert.ok((pdf.toString("latin1").match(/\/URI\b/g)||[]).length>=3);
  const docx=await exportDocx(revised);
  assert.equal(docx.subarray(0,2).toString(),"PK");
});
