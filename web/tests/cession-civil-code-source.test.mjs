import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry} from "../legal/sources.mjs";
import {isCivilAssignmentQuestion,specificNumbers,
  getLiveOfficialArticleContext} from "../legal/live-official.mjs";
import {officialExportReferences} from "../legal/export-references.mjs";
import {exportPdf} from "../export.mjs";

const registry=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
const general=registry.find(x=>x.id==="gk-general");
const legalQuestion=[
 "Прочитай три страницы соглашения об уступке и уведомления.",
 "Определи, подтверждён ли переход права требования по договору займа к Компании Б.",
 "Сопоставь реестр, исполнение покупки, основной долг, пеню и банковский чек."
].join("\n");
const html="<html><article>"+
  "<p><b><a name='z1000'></a>Статья 339. Основания и порядок перехода прав кредитора к другому лицу</b></p>"+
  "<p>1. Право требования принадлежит кредитору и может передаваться по сделке; при надлежащей уступке изучаются последствия для должника и уведомление первоначального кредитора.</p>"+
  "<p><b><a name='z1001'></a>Статья 341. Объем прав кредитора, переходящих к другому лицу</b></p>"+
  "<p>1. Если иное не предусмотрено законодательством или договором, право первоначального кредитора переходит к новому в существовавшем на дату перехода объеме и условиях.</p>"+
  "<p><b><a name='z1002'></a>Статья 342. Доказательства прав нового кредитора</b></p>"+
  "<p>1. Должник может не исполнять обязательство новому кредитору до представления доказательств перехода права требования к данному лицу.</p>"+
  "<p><b><a name='z1003'></a>Статья 343. Возражения должника против требования нового кредитора</b></p>"+
  "<p>Должник вправе предъявлять новому кредитору возражения, которые имел против первоначального кредитора в установленный законом момент.</p>"+
  "<p><b><a name='z1004'></a>Статья 345. Условия уступки требования</b></p>"+
  "<p>1. Уступка требования допустима, если она не противоречит условиям договора или специальным ограничениям закона, подлежащим изучению.</p>"+
  "<p><b><a name='z1005'></a>Статья 346. Форма уступки требования</b></p>"+
  "<p>1. Уступка права, основанного на письменном договоре, должна оформляться в предусмотренной законом соответствующей письменной форме.</p>"+
  "<p><b><a name='z1006'></a>Статья 347. Ответственность кредитора</b></p>"+
  "<p>Содержание следующей статьи не должно включаться в текст предыдущей, иначе парсер потеряет границы и ошибочно процитирует её.</p>"+
  "</article></html>";

test("cession without user-supplied article numbers gets the specific GK material source",()=>{
  assert.ok(isCivilAssignmentQuestion(legalQuestion));
  assert.deepEqual(specificNumbers(legalQuestion,general),["339","341","342","343","345","346"]);
  assert.equal(isCivilAssignmentQuestion("Как получить судебный приказ?"),false);
});
test("for mixed loan and assignment question live source priority is GK General Part, not loan or GPK",async()=>{
  const urls=[];
  const result=await getLiveOfficialArticleContext(registry,legalQuestion,{
    asOf:"2026-11-21",fetchImpl:async(url,opts)=>{
      urls.push(url);
      assert.equal(opts.redirect,"error");
      assert.equal(url,"https://old.adilet.zan.kz/rus/docs/K940001000_");
      return new Response(html,{headers:{"content-type":"text/html"}});
    }
  });
  assert.deepEqual(urls,["https://old.adilet.zan.kz/rus/docs/K940001000_"]);
  for(const n of ["339","341","342","343","345","346"]){
    assert.match(result,new RegExp("СТАТЬЯ "+n));
  }
  assert.doesNotMatch(result,/Статья 347/);
  assert.match(result,/НЕ ИСТОРИЧЕСКАЯ РЕДАКЦИЯ/);
  assert.match(result,/историю и переходные положения/);
  assert.match(result,/K940001000_/);
});
test("offline source must never be presented as a verified historical GK article",async()=>{
  const result=await getLiveOfficialArticleContext(registry,legalQuestion,{
    fetchImpl:async()=>{throw new Error("official unavailable");}
  });
  assert.match(result,/онлайн-текст нужных статей Әділет недоступен/);
  assert.match(result,/K940001000_/);
  assert.doesNotMatch(result,/ША256|SHA256/);
});
test("ten-page civil assignment report receives GK and historical edition links, alongside GPK 72",async()=>{
  const answer=[
    "6. Законодательство и проверка редакций",
    "Статья 339 ГК РК. Статья 341 ГК РК. Статья 342 ГК РК.",
    "Статья 343 ГК РК. Статьи 345–346 ГК РК.",
    "Статья 72 ГПК РК — обязанность доказывания.",
    "Для событий марта 2025 года проверить историческую редакцию Гражданского кодекса РК.",
    "Уступка права требования не подтверждена, платёж и пеню требуется проверять."
  ].join("\n");
  const refs=officialExportReferences(answer);
  assert.ok(refs.some(x=>x.url==="https://old.adilet.zan.kz/rus/docs/K940001000_"));
  assert.ok(refs.some(x=>x.url==="https://old.adilet.zan.kz/rus/docs/K940001000_/history"));
  assert.ok(refs.some(x=>x.url==="https://old.adilet.zan.kz/rus/docs/K1500000377"));
  assert.ok(refs.some(x=>/339.*341.*342.*343/.test(x.label)));
  assert.ok(refs.every(x=>x.url.startsWith("https://old.adilet.zan.kz/rus/docs/")));
  const pdf=await exportPdf(answer);
  assert.ok((pdf.toString("latin1").match(/\/URI\b/g)||[]).length>=3);
  assert.match(pdf.toString("latin1"),/K940001000_/);
});
test("do not invent a Civil Code reference just because an unrelated act uses article 339",()=>{
  const refs=officialExportReferences("УК РК статья 339. ГПК РК статья 72.");
  assert.ok(refs.every(x=>!x.url.includes("K940001000_")));
});
