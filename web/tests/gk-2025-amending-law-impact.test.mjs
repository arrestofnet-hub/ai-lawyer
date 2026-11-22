import test from "node:test";
import assert from "node:assert/strict";
import {parseOfficialPublicationMetadata,parseAmendingLawEnactment,addDays} from "../legal/publication.mjs";
import {parseGk2025Law179Scope,getGk2025Law179ImpactContext} from "../legal/gk-2025-enactment.mjs";

const ROOT="https://old.adilet.zan.kz/rus/docs/Z2500000179";
const law=[
'<html><article>',
'<p><b><a name="z4"></a>Статья 1. Внести изменения и дополнения в следующие законодательные акты Республики Казахстан:</b></p>',
'<p id="z5">1. В <a href="/rus/docs/K940001000_#z5961">Гражданский кодекс</a> Республики Казахстан от 27 декабря 1994 года:</p>',
'<p id="z6">1) в <a href="/rus/docs/K940001000_#z8267">статье 193-1</a>:</p>',
'<p id="z7">часть первую пункта 2 после слова "водохозяйственные" дополнить словами "и гидротехнические";</p>',
'<p id="z8">пункт 3 дополнить словами ", если иное не предусмотрено законодательными актами Республики Казахстан";</p>',
'<p id="z9">2) часть первую пункта 3 <a href="/rus/docs/K940001000_#z1457">статьи 242</a> дополнить предложением третьим следующего содержания:</p>',
'<p id="z10">"При этом в случаях, если бесхозяйная вещь является объектом жизнеобеспечения населения, законами Республики Казахстан может предусматриваться ее временная эксплуатация".</p>',
'<p id="z11">2. В <a href="/rus/docs/K030000442_#z1">Земельный кодекс</a> Республики Казахстан от 20 июня 2003 года:</p>',
'<p id="z12">1) в статье 339 земельного законодательства уточнить полномочия по использованию водного фонда.</p>',
'<p><b><a name="z197"></a>Статья 2.</b></p>',
'<p id="z198">1. Настоящий Закон вводится в действие по истечении шестидесяти календарных дней после дня его первого официального опубликования, за исключением подпункта 1) пункта 18 статьи 1, который вводится в действие со 2 июля 2025 года.</p>',
'<p id="z199">2. Приостановить до 1 января 2027 года действие подпункта 4) пункта 2 статьи 1 настоящего Закона.</p>',
'</article></html>'
].join("");
const info=[
'<html><body>',
'<h1>О внесении изменений и дополнений в некоторые законодательные акты Республики Казахстан по вопросам охраны и использования водного фонда</h1>',
'<p>Закон Республики Казахстан от 9 апреля 2025 года № 179-VIII ЗРК.</p>',
'<table><tr><th>Параметр</th><th>Значение</th></tr>',
'<tr><td>Дата принятия акта</td><td>09.04.2025</td></tr>',
'<tr><td>Информация об официальном опубликовании акта</td>',
'<td>газета "Егемен Қазақстан", №67 10.04.2025 г., газета "Казахстанская правда", №67 10.04.2025 г., Эталонный контрольный банк НПА РК в электронном виде, 11.04.2025 г.</td></tr>',
'<tr><td>Регистрационный номер НПА, присвоенный нормотворческим органом</td><td>179-VIII</td></tr></table>',
'</body></html>'
].join("");

test("Law 179-VIII amends GK 193-1 and 242, not 339-346, despite another act's art.339",()=>{
  const x=parseGk2025Law179Scope(law);
  assert.deepEqual(x.changedArticles,["193-1","242"]);
  assert.deepEqual(x.unaffectedInThisLaw,["339","341","342","343","345","346"]);
  assert.match(x.scopeExcerpt,/временная эксплуатация/);
  assert.doesNotMatch(x.scopeExcerpt,/земельного законодательства/);
  assert.throws(()=>parseGk2025Law179Scope(law.replace("статьи 242","статьи 342")));
});

test("Adilet archive HTML with nonbreaking-space indentation preserves legal scope",()=>{
  const archiveLike=law
    .replace('<p id="z5">1. В','<p id="z5">\\n&nbsp;&nbsp;&nbsp; 1. В')
    .replace('<p id="z11">2. В','<p id="z11">\\n&nbsp;&nbsp;&nbsp; 2. В');
  const x=parseGk2025Law179Scope(archiveLike);
  assert.deepEqual(x.changedArticles,["193-1","242"]);
  assert.doesNotMatch(x.scopeExcerpt,/земельного законодательства/);
  assert.throws(()=>parseGk2025Law179Scope(
    archiveLike.replace("статьи 242","статьи 342")));
});

test("identified unmarked official info gives April 10 first publication, never trust wrong act",()=>{
  const p=parseOfficialPublicationMetadata(info,{actId:"Z2500000179"});
  assert.equal(p.firstReportedPublication,"2025-04-10");
  assert.deepEqual(p.reportedDates,["2025-04-10","2025-04-11"]);
  assert.equal(p.individualGazetteVerified,false);
  assert.throws(()=>parseOfficialPublicationMetadata(info,{actId:"Z2600000306"}));
  assert.throws(()=>parseOfficialPublicationMetadata(info.replace("179-VIII","180-VIII"),{actId:"Z2500000179"}));
});

test("law's general 60-day rule yields June 10, with exceptions and no blanket legal confirmation",()=>{
  const e=parseAmendingLawEnactment(law,{actId:"Z2500000179"});
  assert.equal(e.calendarDays,60);
  assert.equal(e.exceptionsPresent,true);
  assert.equal(e.legalApplicabilityVerified,false);
  assert.equal(addDays("2025-04-10",61),"2025-06-10");
});

test("official evidence report is cited, bounded and never equates archive date with entry",async()=>{
  const calls=[];
  const report=await getGk2025Law179ImpactContext({fetchImpl:async(url,opts)=>{
    calls.push(url);assert.equal(opts.redirect,"error");
    return new Response(url.endsWith("/info")?info:law,{
      headers:{"content-type":"text/html"}
    });
  }});
  assert.deepEqual(calls.sort(),[ROOT,ROOT+"/info"].sort());
  for(const token of ["193-1, 242","339, 341, 342, 343, 345, 346","2025-04-10","2025-06-10","НЕ означает","НЕ подтверждены","пункта 18 статьи 1","/info"])
    assert.ok(report.includes(token),"missing "+token);
});

test("inaccessible or altered official act cannot fabricate a date or unchanged articles",async()=>{
  const offline=await getGk2025Law179ImpactContext({
    fetchImpl:async()=>{throw Error("offline");}
  });
  assert.match(offline,/НЕ ЗАВЕРШЕНА/);
  assert.doesNotMatch(offline,/2025-06-10/);
  const altered=await getGk2025Law179ImpactContext({
    fetchImpl:async u=>new Response(u.endsWith("/info")?info:law.replace("статьи 242","статьи 342"),{
      headers:{"content-type":"text/html"}
    })
  });
  assert.match(altered,/НЕ ЗАВЕРШЕНА/);
  assert.doesNotMatch(altered,/193-1, 242/);
});
