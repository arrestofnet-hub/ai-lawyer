import test from "node:test";
import assert from "node:assert/strict";
import {parseOfficialArticles,getLiveOfficialArticleContext} from "../legal/live-official.mjs";

const notary=[{
  id:"notary",actId:"Z970000155_",title:"О нотариате",
  officialUrl:"https://adilet.zan.kz/rus/docs/Z970000155_",
  keywords:["нотари","исполнительн надпис"]
}];
const html=`<!DOCTYPE html><html><head><title>О нотариате - ИПС Әділет</title></head><body>
<article>
<p><b><a name="z300"></a>Статья 92-5. Сроки предъявления исполнительной надписи</b></p>
<p>Исполнительная надпись может быть предъявлена к принудительному исполнению в течение трех лет со дня ее совершения, если законодательством не установлены другие сроки.</p>
<p><b><a name="z301"></a>Статья 92-6. Направление должнику копии исполнительной надписи</b></p>
<p>1. После совершения исполнительной надписи нотариус не позднее следующего рабочего дня направляет ее копию должнику с уведомлением о вручении.</p>
<p>2. Должник вправе в течение десяти рабочих дней со дня получения копии исполнительной надписи направить нотариусу мотивированное возражение.</p>
<p>3. Возражение должно содержать причины несогласия с заявленным требованием.</p>
<p><b><a name="z302"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>
<p>1. Нотариус выносит постановление об отмене исполнительной надписи не позднее трех рабочих дней со дня получения возражения против заявленного требования.</p>
<p>2. Постановление об отмене исполнительной надписи не допускает автоматической проверки на вымышленную историческую дату без дополнительных официальных сведений.</p>
<p><b><a name="z303"></a>Статья 92-9. Другая статья</b></p>
<p>Последующая статья должна быть исключена из текста статьи 92-8; это проверка корректного разделения целого текста юридического документа.</p>
</article></body></html>`;
const mockFetch=(url,options)=>{
  assert.match(url,/^https:\/\/(old\.)?adilet\.zan\.kz\/rus\/docs\/Z970000155_$/);
  assert.equal(options.redirect,"error");
  return Promise.resolve(new Response(html,{status:200,headers:{"content-type":"text/html; charset=utf-8"}}));
};

test("full official HTML is split into distinct, non-overlapping article texts",()=>{
  const got=parseOfficialArticles(html,["92-6","92-8"]);
  assert.deepEqual(got.map(x=>x.article),["92-6","92-8"]);
  assert.equal(got[0].anchor,"z301");
  assert.match(got[0].text,/десяти рабочих дней/);
  assert.match(got[1].text,/трех рабочих дней/);
  assert.doesNotMatch(got[1].text,/Последующая статья/);
  assert.match(got[0].sha256,/^[a-f0-9]{64}$/);
});

test("live legal evidence carries exact official article link and explicitly unverified edition",async()=>{
  const context=await getLiveOfficialArticleContext(notary,
    "Какие сроки отмены исполнительной надписи нотариуса?",{
      fetchImpl:mockFetch,asOf:"2026-11-21"});
  assert.match(context,/adilet\.zan\.kz\/rus\/docs\/Z970000155_#z301/);
  assert.match(context,/Статья 92-6/);
  assert.match(context,/Статья 92-8/);
  assert.match(context,/2026-11-21/);
  assert.match(context,/НЕ ПОДТВЕРЖДЕНА|НЕ подтверждены|НЕ ПРОВЕРКА/);
  assert.match(context,/десяти рабочих дней/);
});

test("historical case is never described as a verified historical edition",async()=>{
  const result=await getLiveOfficialArticleContext(notary,
    "Отмена исполнительной надписи от 18.04.2024: сроки и уведомление",{
      fetchImpl:mockFetch,asOf:"2026-11-21"});
  assert.match(result,/НЕ ИСТОРИЧЕСКАЯ РЕДАКЦИЯ/);
  assert.match(result,/Для событий в прошлом проверь историю/);
});

test("failed official fetch does not fabricate article verification",async()=>{
  const failed=async()=>{throw new Error("network timeout");};
  const result=await getLiveOfficialArticleContext(notary,
    "Срок отмены исполнительной надписи нотариуса",{
      fetchImpl:failed,asOf:"2026-11-21"});
  assert.match(result,/онлайн-текст нужных статей Әділет недоступен/);
  assert.match(result,/Не говори, что проверил статьи/);
});

test("official retrieval never sends a client question or arbitrary URL to the network",async()=>{
  const sent=[];
  await getLiveOfficialArticleContext(notary,
    "Исполнительная надпись нотариуса; https://attacker.invalid/secret?client=123",{
      fetchImpl:async(url,options)=>{
        sent.push(url);
        return mockFetch(url,options);
      },asOf:"2026-11-21"});
  assert.deepEqual(sent,["https://old.adilet.zan.kz/rus/docs/Z970000155_"]);
  let requests=0;
  const empty=await getLiveOfficialArticleContext(notary,"Как кормить кошку?",{
    fetchImpl:async()=>{requests++;return mockFetch();},asOf:"2026-11-21"});
  assert.equal(requests,0);assert.equal(empty,"");
});

test("truncated or forged partial official text is rejected",()=>{
  assert.throws(()=>parseOfficialArticles("<article>Статья 92-6. Текст</article>",["92-6"]));
  assert.throws(()=>parseOfficialArticles("<article>"+("текст ".repeat(100))+"</article>",["92-6"]));
});
