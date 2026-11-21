import test from "node:test";
import assert from "node:assert/strict";
import {parseOfficialPublicationMetadata,parseAmendingLawEnactment,getPublicationReviewContext} from "../legal/publication.mjs";

const info=(act,date1,date2)=>'<html><body><table id="ethernatable">'+
  '<tr><td>Дата принятия акта</td><td>21.01.2019</td></tr>'+
  '<tr><td>Информация об официальном опубликовании акта</td><td>'+
  'Эталонный контрольный банк НПА РК в электронном виде, '+date2+' г., '+
  '"Егемен Қазақстан" '+date1+' ж., № 14 (29493); "Казахстанская правда" от '+
  date1+' г., № 14 (28891)</td></tr>'+
  '<tr><td>Форма акта</td><td>Закон, изменения</td></tr>'+
  '</table><p>Информация об акте '+act+'</p></body></html>';
const oldLaw='<html><article><p>Статья 1. Изменить положения Закона РК о нотариате.</p>'+
  '<p>Статья 2. Норма подпункта 1) имеет переходные положения и ограничения.</p>'+
  '<p>Другие переходные нормы настоящего Закона.</p>'+
  '<p id="z736">Статья 3. Настоящий Закон вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования, за исключением:</p>'+
  '<p id="z737">1) подпунктов 3), 4) и 5) пункта 15, а также некоторых положений пункта 31 статьи 1, которые вводятся в действие по истечении трех месяцев со дня его первого официального опубликования;</p>'+
  '<p id="z738">2) пункта 12 статьи 1, который вводится в действие с 16 июля 2018 года;</p>'+
  '<p id="z739">3) абзацев пятого и шестого подпункта 2) пункта 15, которые вводятся в действие по истечении восьми месяцев со дня первого официального опубликования.</p>'+
  '<p>Президент Республики Казахстан</p></article></html>';
const newLaw='<html><article><p>Статья 1. Изменения в Закон Республики Казахстан о нотариате, вводимые различными нормами.</p>'+
  '<p>Изменение к статье 92-6 и статье 92-8.</p>'+
  '<p id="z301">Статья 2.</p>'+
  '<p id="z302">1. Настоящий Закон вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования, за исключением:</p>'+
  '<p id="z303">1) подпунктов 14), 15), 23), 25), 28), 29), 31), 32), 33), 38) пункта 1 статьи 1, которые вводятся в действие с 1 июля 2021 года;</p>'+
  '<p id="z304">2) подпункта 2), абзаца пятого подпункта 3), абзаца седьмого подпункта 4), которые вводятся в действие с 1 января 2022 года.</p>'+
  '<p id="z305">2. Приостановить до 1 июля 2021 года действие абзаца.</p>'+
  '<p>Президент Республики Казахстан</p></article></html>';
const archived='<html><article>'+
  '<p><b><a name="z691"></a>Статья 92-5. Сроки предъявления исполнительной надписи</b></p>'+
  '<p>Нотариальная исполнительная надпись может быть предъявлена к исполнению в установленные сроки.</p>'+
  '<p><b><a name="z692"></a>Статья 92-6. Направление должнику копии исполнительной надписи</b></p>'+
  '<p>Копия исполнительной надписи направляется должнику с использованием допустимых средств связи.</p>'+
  '<p class="note">Сноска. Заголовок статьи 92-6 изменен Законом РК от 21.01.2019 <a href="/rus/docs/Z1900000217#z332">№ 217-VI</a> (вводится в действие после официального опубликования).</p>'+
  '<p><b><a name="z698"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>'+
  '<p>Нотариус отменяет исполнительную надпись при наличии законного основания и возражений.</p>'+
  '<p class="note">Сноска. Статья 92-8 изменена Законом РК от 15.02.2021 <a href="/rus/docs/Z2100000005#z282">№ 5-VII</a> (вводится в действие после первого официального опубликования).</p>'+
  '<h3>Глава 15. О других нотариальных действиях</h3>'+
  '<p class="note">Сноска. Заголовок главы 15 изменен Законом <a href="/rus/docs/Z980000302_">№ 302</a></p>'+
  '<p><b><a name="z700"></a>Статья 93. Сохранение документов</b></p>'+
  '<p>Следующая статья отличается от нотариальной исполнительной надписи и не относится к статье 92-8.</p>'+
  '</article></html>';
const docs={
  "Z1900000217":{info:info("Z1900000217","23.01.2019","24.01.2019"),law:oldLaw},
  "Z2100000005":{info:info("Z2100000005","16.02.2021","19.02.2021"),law:newLaw}
};
test("official metadata selects earliest reported publication not the later control-bank posting",()=>{
  const a=parseOfficialPublicationMetadata(docs.Z1900000217.info,{actId:"Z1900000217"});
  const b=parseOfficialPublicationMetadata(docs.Z2100000005.info,{actId:"Z2100000005"});
  assert.equal(a.firstReportedPublication,"2019-01-23");
  assert.deepEqual(a.reportedDates,["2019-01-23","2019-01-24"]);
  assert.equal(b.firstReportedPublication,"2021-02-16");
  assert.deepEqual(b.reportedDates,["2021-02-16","2021-02-19"]);
  assert.equal(a.individualGazetteVerified,false);
  assert.throws(()=>parseOfficialPublicationMetadata('<html>not available</html>',{actId:"Z1900000217"}));
});
test("law enactment parsing finds article 3 of 2019 and article 2 of 2021, and all exceptions remain open",()=>{
  const a=parseAmendingLawEnactment(oldLaw,{actId:"Z1900000217"});
  const b=parseAmendingLawEnactment(newLaw,{actId:"Z2100000005"});
  assert.equal(a.article,"3");assert.equal(b.article,"2");
  assert.equal(a.calendarDays,10);assert.equal(b.calendarDays,10);
  assert.equal(a.exceptionsPresent,true);assert.equal(b.exceptionsPresent,true);
  assert.match(b.exceptionEvidence.join(" "),/1 июля 2021/);
  assert.equal(b.legalApplicabilityVerified,false);
  assert.throws(()=>parseAmendingLawEnactment("<html>missing law</html>",{actId:"Z2100000005"}));
});
test("live publication audit provides candidate dates and never equates those to legally effective provisions",async()=>{
  const urls=[];
  const context=await getPublicationReviewContext({
    actId:"Z970000155_",articleNumbers:["92-6","92-8"],priorHtml:archived,
    asOf:"2026-11-21",
    fetchImpl:async(url,opts)=>{
      urls.push(url);assert.equal(opts.redirect,"error");
      const match=url.match(/\/rus\/docs\/(Z\d+)(?:\/info)?$/);
      assert.ok(match);const item=docs[match[1]];assert.ok(item);
      return new Response(url.endsWith("/info")?item.info:item.law,{headers:{"content-type":"text/html"}});
    }
  });
  assert.equal(urls.length,4);
  assert.ok(urls.every(x=>x.startsWith("https://old.adilet.zan.kz/rus/docs/Z")));
  assert.match(context,/2019-01-23/);assert.match(context,/2019-02-03/);
  assert.match(context,/2021-02-16/);assert.match(context,/2021-02-27/);
  assert.match(context,/исключения: ПРЕДУСМОТРЕНЫ, применимость НЕ проверена/);
  assert.match(context,/юридическая дата действия конкретной поправки НЕ ПОДТВЕРЖДЕНА/);
  assert.doesNotMatch(context,/Z980000302_/);
});
test("failed amended-law publication read fails closed and does not fabricate date",async()=>{
  const context=await getPublicationReviewContext({
    actId:"Z970000155_",articleNumbers:["92-6","92-8"],priorHtml:archived,
    fetchImpl:async()=>{throw Error("network offline");}
  });
  assert.match(context,/не указывать вычисленную дату/);
  assert.doesNotMatch(context,/2019-02-03|2021-02-27/);
});
