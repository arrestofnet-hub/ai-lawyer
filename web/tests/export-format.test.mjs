import test from "node:test";
import assert from "node:assert/strict";
import { parseLegalMarkdown, inlineTokens, plainText } from "../format.mjs";
import { exportDocx, exportPdf } from "../export.mjs";

const sample=`# Юридическое заключение

**Вывод:** необходимо проверить документы.

| Документ | Противоречие |
|---|---|
| Договор | Сумма не совпадает |
| Платёж | Дата указана ошибочно |

1. Запросить материалы.
2. Проверить сроки.

Согласно материалам, вывод не окончательный.`;

test("legal Markdown is parsed into readable, structured blocks",()=>{
  const blocks=parseLegalMarkdown(sample);
  assert.equal(blocks[0].kind,"heading");
  assert.equal(blocks[1].kind,"paragraph");
  assert.equal(blocks[2].kind,"table");
  assert.equal(blocks[2].headers[0],"Документ");
  assert.equal(blocks[2].rows.length,2);
  assert.equal(blocks[3].kind,"ordered");
  assert.equal(blocks[3].items.length,2);
  assert.equal(plainText("**Вывод:** риск"),"Вывод: риск");
  assert.ok(inlineTokens("**Важно:** документ").some(t=>t.kind==="strong"&&t.text==="Важно:"));
});

test("DOCX export generates an actual zipped Word document",async()=>{
  const buffer=await exportDocx(sample);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0,2).toString(),"PK");
  assert.ok(buffer.length>2500);
});

test("PDF export generates a genuine PDF with a Cyrillic font",async()=>{
  const buffer=await exportPdf(sample);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0,5).toString(),"%PDF-");
  assert.ok(buffer.length>4000);
});
