import test from "node:test";
import assert from "node:assert/strict";
import {analyzeLayQuestion,buildLayIntakeContext,enrichLayLegalSearchQuery}
  from "../legal/issue-intake.mjs";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const cases=[
  {q:"У меня Каспи карту заблокировали. Чсишник говорит оплатить. Что делать?",
    ids:["blocked_account","bailiff","informal_relief"],missing:["court_order","notarial_instrument"]},
  {q:"Мне судебник прислал бумажку, долг продали коллекторам, я уже платил раньше",
    ids:["bailiff","assignment","debt_dispute","payment_dispute"],missing:[]},
  {q:"Нотариус сделал надпись, ее не получала, деньги списали с карты",
    ids:["notarial_instrument","no_notice","blocked_account"],missing:[]},
  {q:"Приказ от суда пришел, а я ни о чём не знал, отмените пожалуйста",
    ids:["court_order","no_notice","informal_relief"],missing:[]},
  {q:"КСК за квартиру требует капремонт и пеню, хотя я оплатила",
    ids:["housing","debt_dispute"],missing:[]},
  {q:"Суд без меня решил взыскать деньги. Как вернуть деньги?",
    ids:["court_decision","informal_relief"],missing:[]},
  {q:"Арестовали меня по уголовному делу, помогите",
    ids:["informal_relief"],missing:["blocked_account"]},
  {q:"Я получил исполнительный документ от нотариуса и хочу узнать срок.",
    ids:["notarial_instrument"],missing:["no_notice"]}
];
test("ordinary Kazakhstan legal descriptions activate plausible issue signals, not final conclusions",()=>{
  for(const c of cases){
    const ids=analyzeLayQuestion(c.q).signals.map(x=>x.id);
    for(const id of c.ids)assert.ok(ids.includes(id),"missing "+id+" in "+c.q);
    for(const id of c.missing)assert.ok(!ids.includes(id),"unexpected "+id+" in "+c.q);
  }
});
test("blocked bank card without underlying act never presumes a notarial inscription or bailiff",()=>{
  const q="Карточка у меня в минусе, как вернуть деньги?";
  const r=analyzeLayQuestion(q);
  assert.equal(r.ambiguousEnforcement,true);
  const expanded=enrichLayLegalSearchQuery(q);
  assert.doesNotMatch(expanded,/исполнительная надпись нотариуса/);
  const guidance=buildLayIntakeContext(q);
  assert.match(guidance,/источник пока не определён/);
  assert.match(guidance,/предмет конкретного вопроса и предмет материально-правового спора/);
});
test("inference expands only discovery hints; does not invent a confirmed source",()=>{
  const q="ЧСИ снял деньги с каспи, нотариус как-то связан, долг по кредиту";
  const expanded=enrichLayLegalSearchQuery(q);
  assert.match(expanded,/ПОИСКОВЫЕ ГИПОТЕЗЫ \(не факты\)/);
  assert.match(expanded,/исполнительная надпись нотариуса \(возможный источник, не факт\)/);
  assert.match(buildLayIntakeContext(q),/не означает, что обжалуется только постановление ЧСИ/);
});
test("document intake requires full-context close reading and clearly labels unreadable areas",()=>{
  const text=buildLayIntakeContext("Рассмотри договор",{documentCount:3});
  assert.match(text,/Прочитай каждый доступный файл полностью/);
  assert.match(text,/если файл недоступен\/скан неразборчив/);
  assert.match(text,/не имитируй прочтение/);
});
test("legal methodology mandates distinct claim, dispute, proof, syntax and version",()=>{
  const p=fileURLToPath(new URL("../strategy/LEGAL_REASONING_METHODS_V4.md",import.meta.url));
  const v4=readFileSync(p,"utf8");
  for(const word of ["предмет вопроса","предмет спора","предмет доказывания",
    "не", "«и»", "«или»", "«и (или)»", "сноски","пословно","страница",
    "правовую квалификацию","доказывания"]){
    assert.ok(v4.includes(word),"Method missing "+word);
  }
  assert.match(v4,/не утверждай, что прочитаны все книги/i);
  assert.match(v4,/утверждение заявителя, формулировку оппонента/);
});
