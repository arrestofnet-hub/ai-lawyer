import test from "node:test";
import assert from "node:assert/strict";
import {verifyNotarialAmendment343,getNotarial343Context} from "../legal/notary-343.mjs";

const act="Z2600000343";
const info='<html><table id="ethernatable">'+
  '<tr><td>Дата принятия акта</td><td>08.07.2026</td></tr>'+
  '<tr><td>Информация об официальном опубликовании акта</td>'+
  '<td>газета "Егемен Қазақстан", №126 (31357) 09.07.2026 г., '+
  'газета "Казахстанская правда", №126 (30755) 09.07.2026 г., '+
  'Эталонный контрольный банк НПА РК в электронном виде, 13.07.2026 г.</td></tr>'+
  '</table></html>';
const law='<html><article>'+
  '<p><b>Статья 1. Внести изменения и дополнения в следующие законодательные акты Республики Казахстан:</b></p>'+
  '<p>1. В Предпринимательский кодекс Республики Казахстан внести изменения и дополнения.</p>'+
  '<p>2. В Кодекс Республики Казахстан об административных правонарушениях внести изменения и дополнения.</p>'+
  '<p>3. В Закон Республики Казахстан от 14 июля 1997 года "О нотариате":</p>'+
  '<p>34) в статье 92-2 изложить положения о совершении исполнительной надписи и месте регистрации.</p>'+
  '<p>36) в статье 92-6 уточнить способы уведомления должника.</p>'+
  '<p>37) в <a href="/rus/docs/Z970000155_#z698">статье 92-8</a> :</p>'+
  '<p><a href="/rus/docs/Z970000155_#z787">пункт 1</a> дополнить частью второй следующего содержания:</p>'+
  '<p>"В случае, если в возражении должника не указаны причины несогласия с требованием либо оно подано с нарушением срока, нотариус отказывает в отмене исполнительной надписи.";</p>'+
  '<p>часть третью <a href="/rus/docs/Z970000155_#z788">пункта 2</a> после слов "не отменена" дополнить словами "и (или) передана судебному исполнителю к принудительному исполнению".</p>'+
  '<p>4. В Закон Республики Казахстан от 19 мая 2015 года внести изменения.</p>'+
  '<p><b>Статья 2.</b></p>'+
  '<p>1. Настоящий Закон вводится в действие по истечении шестидесяти календарных дней после дня его первого официального опубликования, за исключением абзацев третьего и четвертого <a href="#z34">подпункта 4)</a> и абзацев второго и третьего <a href="#z300">подпункта 34)</a> пункта 3 статьи 1, которые вводятся в действие с 1 января 2027 года.</p>'+
  '<p>2. Установить, что:</p>'+
  '<p>1) отдельные переходные положения регулируют состав нотариальной палаты.</p>'+
  '<p>2) отдельные положения применяются к председателям ранее избранных комиссий.</p>'+
  '</article></html>';

test("exact amended subitem 37 differs from exceptions 4 and 34",()=>{
  const x=verifyNotarialAmendment343(law,info);
  assert.equal(x.firstOfficialPublication,"2026-07-09");
  assert.equal(x.effectiveDate,"2026-09-08");
  assert.equal(x.subitem,37);
  assert.deepEqual(x.deferredSubitems,[4,34]);
  assert.equal(x.deferredDate,"2027-01-01");
  assert.equal(x.transitionToEarlierActsVerified,false);
  assert.match(x.targetAmendmentUrl,/Z2600000343#z317$/);
});

test("specific amendment effectiveness appears in model context once official pages are read",async()=>{
  const urls=[];
  const output=await getNotarial343Context({
    asOf:"2026-11-21",
    fetchImpl:async(url,opts)=>{
      urls.push(url);
      assert.equal(opts.redirect,"error");
      assert.match(url,/^https:\/\/old\.adilet\.zan\.kz\/rus\/docs\/Z2600000343(?:\/info)?$/);
      return new Response(url.endsWith("/info")?info:law,
        {headers:{"content-type":"text/html"}});
    }
  });
  assert.deepEqual(new Set(urls),new Set([
    "https://old.adilet.zan.kz/rus/docs/Z2600000343",
    "https://old.adilet.zan.kz/rus/docs/Z2600000343/info"
  ]));
  assert.match(output,/2026-09-08/);
  assert.match(output,/подпунктам 4 и 34/);
  assert.match(output,/НЕ относятся к подпункту 37/);
  assert.match(output,/УЖЕ ВСТУПИЛА В СИЛУ/);
});

test("same official evidence cannot be treated as operative before commencement",async()=>{
  const output=await getNotarial343Context({
    asOf:"2026-08-20",
    fetchImpl:async url=>new Response(url.endsWith("/info")?info:law,
      {headers:{"content-type":"text/html"}})
  });
  assert.match(output,/ЕЩЁ НЕ ВСТУПИЛА В СИЛУ/);
});

test("a missing exact clause or newly delayed item 37 fails closed",()=>{
  assert.throws(()=>verifyNotarialAmendment343(
    law.replace("37) в <a","38) в <a"),info));
  assert.throws(()=>verifyNotarialAmendment343(
    law.replace("подпункта 34)","подпункта 37)"),info));
});

test("offline or untrusted official source never yields a verified effectiveness date",async()=>{
  const output=await getNotarial343Context({
    fetchImpl:async()=>{throw Error("offline");}
  });
  assert.match(output,/НЕ ЗАВЕРШЕНА/);
  assert.doesNotMatch(output,/Дата вступления именно этой поправки в силу/);
});
