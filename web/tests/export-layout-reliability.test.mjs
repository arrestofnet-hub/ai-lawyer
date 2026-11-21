import test from "node:test";
import assert from "node:assert/strict";
import {numberedExportBlocks,plainLegalText} from "../format.mjs";
import {exportPdf,exportDocx} from "../export.mjs";
const withCitations=[
  "# Порядок исполнения определения",
  "1. Подать заявление о приостановлении взыскания.",
  "Статья 157 ГПК.",
  "1. Получить судебное определение после удовлетворения заявления.",
  "1. Передать копию определения надлежащему органу.",
  "Статья 158 ГПК.",
  "1. Проверить исполнение определения судьи.",
  "",
  "# Следующий самостоятельный вопрос",
  "1. Проверить наличие документов.",
  "2. Запросить недостающие сведения."
].join("\n");
test("numbered legal steps stay consecutive across citation paragraphs and reset at a new heading",()=>{
  const blocks=numberedExportBlocks(withCitations).filter(x=>x.kind==="ordered");
  assert.deepEqual(blocks.map(x=>x.numbers),[[1],[2,3],[4],[1,2]]);
  const text=plainLegalText(withCitations);
  assert.match(text,/1\. Подать заявление/);
  assert.match(text,/2\. Получить судебное определение/);
  assert.match(text,/3\. Передать копию/);
  assert.match(text,/4\. Проверить исполнение/);
  assert.match(text,/1\. Проверить наличие документов/);
});
test("PDF and DOCX remain valid for numbered multi-page legal text with official links",async()=>{
  const lines=Array.from({length:115},(_,i)=>
    "Юридически значимая дата и предмет обращения, пункт "+(i+1)+
    ". Проверить официальный документ и приложенные материалы.");
  const markdown=withCitations+"\n\n"+lines.join("\n\n")+
    "\n\nПодпункт 6 части 1 статьи 156 ГПК РК. Статья 92-8 Закона «О нотариате». "+
    "Нормативное постановление Верховного Суда Республики Казахстан № 6.";
  const pdf=await exportPdf(markdown);
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  assert.ok(pdf.length>15000);
  assert.ok((pdf.toString("latin1").match(/\/URI\b/g)||[]).length>=3);
  const docx=await exportDocx(markdown);
  assert.equal(docx.subarray(0,2).toString(),"PK");
});
