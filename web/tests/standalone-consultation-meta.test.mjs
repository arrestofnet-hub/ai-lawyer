import test from "node:test";
import assert from "node:assert/strict";
import {
  removeUnsolicitedRevisionNotes,qualifyUncertainPaymentDraft
} from "../legal/issue-intake.mjs";
import {exportPdf} from "../export.mjs";

const clientQuestion="У меня Каспи заблокировали, деньги снять не могу. Какой-то судебник говорит, что я должен МФО. Я вроде давно платил, но не помню сколько. Никаких бумаг из суда не получал. Куда писать?";
const response=[
  "## 3. Одновременно восстановите платежи",
  "Запросите банковские выписки и у МФО — договор, подробный расчёт и историю учтённых платежей.",
  "Уточнение к предыдущему ответу: формулировка «ранее я производил платежи» была слишком категоричной. Пока вы не уверены, правильно писать только о возможных платежах и необходимости проверки.",
  "## 4. Куда обращаться после получения документов",
  "Заявление в суд зависит от исполнительного документа. Закон «О нотариате», ГПК, Закон об исполнительном производстве."
].join("\n");

test("replayed first-time lay scenario excludes unsolicited previous-answer self-correction",()=>{
  const fixed=removeUnsolicitedRevisionNotes(clientQuestion,response);
  assert.doesNotMatch(fixed,/Уточнение к предыдущему ответу/);
  assert.doesNotMatch(fixed,/формулировка «ранее я производил платежи» была слишком категоричной/);
  assert.match(fixed,/Пока вы не уверены, правильно писать только о возможных платежах/);
  assert.match(fixed,/Запросите банковские выписки/);
  assert.match(fixed,/## 4\. Куда обращаться/);
});

test("explicit request to correct the prior answer is retained",()=>{
  const question="Исправь свой предыдущий ответ о платежах, покажи, что было неправильно.";
  assert.equal(removeUnsolicitedRevisionNotes(question,response),response);
  assert.equal(removeUnsolicitedRevisionNotes("Сравни с предыдущим ответом",response),response);
});

test("the current client's uncertain payment is still qualified and never turned into proof",()=>{
  const draft="Ранее я производил платежи по обязательству.";
  const corrected=removeUnsolicitedRevisionNotes(clientQuestion,
    qualifyUncertainPaymentDraft(clientQuestion,draft));
  assert.match(corrected,/могли производиться платежи/);
  assert.doesNotMatch(corrected,/^Ранее я производил платежи/);
});

test("unrequested previous educational test meta reference disappears but case facts are untouched",()=>{
  const answer="Снятие ареста и прекращение долга — разные требования.\nИз предыдущих учебных примеров нельзя переносить в ваше дело даты и документы.\nПолучите исполнительный документ.";
  const fixed=removeUnsolicitedRevisionNotes(clientQuestion,answer);
  assert.doesNotMatch(fixed,/учебных примеров/);
  assert.match(fixed,/Снятие ареста и прекращение долга/);
  assert.match(fixed,/Получите исполнительный документ/);
});

test("postprocessed standalone answer remains exportable with clickable act-level sources",async()=>{
  const doc=removeUnsolicitedRevisionNotes(clientQuestion,response);
  const buf=await exportPdf(doc);
  assert.equal(buf.subarray(0,5).toString(),"%PDF-");
  assert.ok((buf.toString("latin1").match(/\/URI\b/g)||[]).length>=3);
});
