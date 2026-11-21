import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry} from "../legal/sources.mjs";
import {getTimelineOfficialContext} from "../legal/historical.mjs";
import {modelResponseIsComplete} from "../core.mjs";

const laws=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
const dates=["01.07.2023","05.07.2024","08.09.2026"];
const history='<html><table id="ethernatable">'+dates.map(d=>
  '<tr><td><a href="/rus/archive/docs/Z970000155_/'+d+'">О нотариате</a></td><td>'+d+'</td></tr>').join("")+
  '</table></html>';
const article='<html><article>'+
  '<p><b><a name="z690"></a>Статья 92-5. Сроки предъявления исполнительной надписи</b></p>'+
  '<p>Исполнительная надпись предъявляется к исполнению в порядке, который предусмотрен действующим законом для заявленного требования.</p>'+
  '<p><b><a name="z692"></a>Статья 92-6. Направление должнику копии исполнительной надписи</b></p>'+
  '<p>1. Нотариус направляет копию исполнительной надписи должнику. Должник вправе направить мотивированное возражение в установленном порядке.</p>'+
  '<p>2. Способы доставки, уведомление и возможность возражения определяются положениями применимого законодательства.</p>'+
  '<p><b><a name="z698"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>'+
  '<p>Нотариус совершает действия при поступлении возражения должника в соответствии с законом. Судебное оспаривание представляет собой самостоятельный способ защиты.</p>'+
  '<p><b><a name="z700"></a>Статья 92-9. Другая статья</b></p>'+
  '<p>Другая статья завершается в этой синтетической фикстуре и не должна попадать в ответ о предыдущем правиле.</p>'+
  '</article></html>';

test("multi-date legal situation retrieves two different statute edition candidates, not 'no online access'",async()=>{
  const urls=[];
  const text="Нормативное постановление Верховного Суда № 6 от 26.05.2022. "+
    "Нотариус совершил исполнительную надпись 18.04.2024, должник узнал от ЧСИ 20.11.2026. "+
    "Проверь статьи 92-6 и 92-8 Закона О нотариате на юридически значимые даты.";
  const out=await getTimelineOfficialContext(laws,text,{
    asOf:"2026-11-21",publicationReview:false,
    fetchImpl:async(url,opts)=>{
      urls.push(url);assert.equal(opts.redirect,"error");
      assert.match(url,/^https:\/\/old\.adilet\.zan\.kz\/rus\//);
      assert.doesNotMatch(url,/P220000006S/);
      return new Response(url.endsWith("/history")?history:article,{
        headers:{"content-type":"text/html"}});
    }
  });
  assert.equal(out.historical,true);
  assert.deepEqual(out.comparedDates,["2024-04-18","2026-11-20"]);
  assert.deepEqual(out.otherDates,["2022-05-26"]);
  assert.match(out.context,/КАНДИДАТНАЯ ДАТА 2024-04-18/);
  assert.match(out.context,/КАНДИДАТНАЯ ДАТА 2026-11-20/);
  assert.match(out.context,/СТАТЬЯ 92-6/);
  assert.match(out.context,/СТАТЬЯ 92-8/);
  assert.match(out.context,/01\.07\.2023/);
  assert.match(out.context,/08\.09\.2026/);
  assert.ok(urls.includes("https://old.adilet.zan.kz/rus/archive/docs/Z970000155_/01.07.2023"));
  assert.ok(urls.includes("https://old.adilet.zan.kz/rus/archive/docs/Z970000155_/08.09.2026"));
  assert.equal(urls.filter(u=>u.endsWith("/history")).length,1,
    "official history must be fetched once for a two-date question");
});

test("provider output status incomplete is never treated as a finished legal opinion",()=>{
  const partial={status:"incomplete",incomplete_details:{reason:"max_output_tokens"},
    output:[{type:"message",content:[{type:"output_text",text:"...или"}]}]};
  assert.equal(modelResponseIsComplete(partial),false);
  assert.equal(modelResponseIsComplete({status:"failed"}),false);
  assert.equal(modelResponseIsComplete({status:"queued"}),false);
  assert.equal(modelResponseIsComplete({status:"completed",incomplete_details:null}),true);
  assert.equal(modelResponseIsComplete({output:[]}),true);
  assert.equal(modelResponseIsComplete(null),null);
});
