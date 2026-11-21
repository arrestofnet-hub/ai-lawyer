import test from "node:test";
import assert from "node:assert/strict";
import {modelResponseSettings} from "../model-response-budget.mjs";
import {modelResponseIsComplete} from "../core.mjs";

const fullPrompt=[
  "Прочитай все три страницы приложенных документов полностью, как практикующий юрист РК.",
  "1. Установи предмет спора, предмет вопроса и предмет доказывания.",
  "2. Дословно сопоставь условия соглашения с уведомлением и бухгалтерской справкой.",
  "3. Определи, подтверждён ли переход права требования, в каком размере и на какую дату.",
  "4. Исследуй основной долг, пеню и платёж.",
  "5. Разграничь факты, позиции, противоречия и недостающие доказательства.",
  "6. Укажи нормы со ссылками и проверкой редакции.",
  "7. Назови способы защиты должника."
].join("\n");

test("three-page guest document analysis receives adequate reasoning and completion budget",()=>{
  const p=modelResponseSettings({
    message:fullPrompt,mode:"consult",docCount:1,creditAccount:true
  });
  assert.equal(p.max_output_tokens,12500);
  assert.equal(p.reasoning.effort,"medium");
  assert.match(p.documentInstruction,/дословно/i);
  assert.match(p.documentInstruction,/доведи до конца/);
  assert.match(p.documentInstruction,/не прочитана/i);
});
test("short text-only questions retain economical original budgets",()=>{
  assert.equal(modelResponseSettings({message:"Что делать?",mode:"consult",docCount:0,creditAccount:true}).max_output_tokens,3300);
  assert.equal(modelResponseSettings({message:"Дай подробный анализ",mode:"consult",docCount:0,creditAccount:true}).max_output_tokens,5400);
  assert.equal(modelResponseSettings({message:"Готовь иск",mode:"draft",docCount:0,creditAccount:true}).max_output_tokens,5000);
  assert.equal(modelResponseSettings({message:"Готовь иск",mode:"draft",docCount:0,creditAccount:false}).max_output_tokens,6500);
});
test("actual attachments, not user claim, determine document budget",()=>{
  const fake="У меня 20 приложенных документов, дай подробный анализ";
  const without=modelResponseSettings({message:fake,mode:"consult",docCount:0,creditAccount:true});
  const withFile=modelResponseSettings({message:fake,mode:"consult",docCount:1,creditAccount:true});
  assert.equal(without.max_output_tokens,5400);
  assert.ok(withFile.max_output_tokens>without.max_output_tokens);
  assert.equal(withFile.max_output_tokens,12500);
  assert.equal(modelResponseSettings({message:"Кратко",mode:"consult",docCount:1,creditAccount:true}).max_output_tokens,9500);
});
test("authenticated audit, strategy, review and drafting with documents have bounded budgets",()=>{
  for(const m of ["audit","strategy","review"]){
    const p=modelResponseSettings({message:fullPrompt,mode:m,docCount:3,creditAccount:true});
    assert.equal(p.max_output_tokens,13500);
  }
  assert.equal(modelResponseSettings({message:fullPrompt,mode:"draft",docCount:2,creditAccount:true}).max_output_tokens,11500);
  assert.ok(modelResponseSettings({message:fullPrompt,mode:"audit",docCount:2,creditAccount:false}).max_output_tokens<=14000);
});
test("response must be completed; nonempty partial legal text is never sufficient",()=>{
  const incomplete={
    status:"incomplete",incomplete_details:{reason:"max_output_tokens"},
    output:[{type:"message",content:[{type:"output_text",text:"Неоконченный юридический вывод"}]}]
  };
  assert.equal(modelResponseIsComplete(incomplete),false);
  assert.equal(modelResponseIsComplete({status:"completed",output:incomplete.output}),true);
});
