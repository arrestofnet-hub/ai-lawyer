import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry,selectProvisionSources,selectOfficialSources} from "../legal/sources.mjs";
import {getLiveOfficialArticleContext} from "../legal/live-official.mjs";
import {getHistoricalOfficialContext} from "../legal/historical.mjs";

const registry=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
const question="Отмена исполнительной надписи нотариуса от 18.04.2024: статьи 92-6 и 92-8";
const history='<html><table id="ethernatable">'+
  ["12.09.2022","01.07.2023","05.07.2024"].map(d=>
    '<tr><td><a href="/rus/archive/docs/Z970000155_/'+d+'">О нотариате</a></td><td>'+d+'</td></tr>').join("")+
  '</table></html>';
const article='<html><article>'+
  '<p><b><a name="z690"></a>Статья 92-5. Сроки предъявления исполнительной надписи</b></p>'+
  '<p>В соответствии с законом нотариус совершает действия в порядке, установленном применимой редакцией.</p>'+
  '<p><b><a name="z692"></a>Статья 92-6. Направление должнику копии исполнительной надписи</b></p>'+
  '<p>1. После совершения исполнительной надписи нотариус направляет ее копию должнику с предусмотренной законом фиксацией доставки.</p>'+
  '<p>2. Должник вправе направить мотивированное возражение в предусмотренные законом сроки.</p>'+
  '<p><b><a name="z698"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>'+
  '<p>Нотариус выносит постановление об отмене исполнительной надписи при наличии и соблюдении предусмотренных законом обстоятельств.</p>'+
  '<p><b><a name="z700"></a>Статья 92-9. Следующий раздел</b></p>'+
  '<p>Эта следующая статья необходима только для проверки того, что предыдущая статья не поглощает лишние данные.</p>'+
  '</article></html>';
test("real 36-act registry prioritizes Law on Notaries for articles 92-6 and 92-8",()=>{
  const ranked=selectProvisionSources(registry,question,{max:3});
  assert.equal(ranked[0].id,"notary");
  assert.equal(ranked[0].actId,"Z970000155_");
  assert.ok(selectOfficialSources(registry,question).some(x=>x.id==="np-notarial-inscription"));
  assert.equal(selectProvisionSources(registry,"Исполнительная надпись нотариуса: срок возражения")[0].id,"notary");
  assert.equal(selectProvisionSources(registry,"Нормативное постановление Верховного Суда об исполнительной надписи № 6 от 26.05.2022")[0].id,"np-notarial-inscription");
});
test("historical engine fetches notary law archival versions instead of court resolution",async()=>{
  const urls=[];
  const result=await getHistoricalOfficialContext(registry,question,{
    asOf:"2026-11-21",
    publicationReview:false,
    fetchImpl:async(url,options)=>{
      urls.push(url);
      assert.equal(options.redirect,"error");
      assert.match(url,/\/Z970000155_\//);
      return new Response(url.endsWith("/history")?history:article,{headers:{"content-type":"text/html"}});
    }
  });
  assert.equal(result.historical,true);
  assert.deepEqual(urls,[
    "https://old.adilet.zan.kz/rus/docs/Z970000155_/history",
    "https://old.adilet.zan.kz/rus/archive/docs/Z970000155_/01.07.2023",
    "https://old.adilet.zan.kz/rus/archive/docs/Z970000155_/05.07.2024"
  ]);
  assert.match(result.context,/СТАТЬЯ 92-6/);
  assert.match(result.context,/СТАТЬЯ 92-8/);
  assert.doesNotMatch(result.context,/P220000006S/);
});
test("live engine likewise fetches notary law instead of court resolution",async()=>{
  const urls=[];
  const result=await getLiveOfficialArticleContext(registry,"Какие сроки отмены исполнительной надписи нотариуса?",{
    asOf:"2026-11-21",
    fetchImpl:async(url,options)=>{
      urls.push(url);
      assert.match(url,/\/Z970000155_$/);
      assert.equal(options.redirect,"error");
      return new Response(article,{headers:{"content-type":"text/html"}});
    }
  });
  assert.deepEqual(urls,["https://old.adilet.zan.kz/rus/docs/Z970000155_"]);
  assert.match(result,/СТАТЬЯ 92-6/);
  assert.doesNotMatch(result,/P220000006S/);
});