import test from "node:test";
import assert from "node:assert/strict";
import {historicalDateHint,parseOfficialHistory,chooseArchiveRevision,getHistoricalOfficialContext} from "../legal/historical.mjs";
const notary=[{id:"notary",actId:"Z970000155_",title:"О нотариате",officialUrl:"https://adilet.zan.kz/rus/docs/Z970000155_",historyUrl:"https://adilet.zan.kz/rus/docs/Z970000155_/history",keywords:["нотари","исполнительн надпис"]}];
const history='<html><table id="ethernatable">'+["12.09.2022","01.07.2023","05.07.2024","18.07.2025"].map(d=>'<tr><td><a href="/rus/archive/docs/Z970000155_/'+d+'">О нотариате</a></td><td>'+d+'</td></tr>').join("")+'</table></html>';
const article='<html><article>'+
'<p><b><a name="z690"></a>Статья 92-5. Сроки предъявления исполнительной надписи</b></p><p>Законом предусмотрен порядок предъявления исполнительной надписи в установленный срок.</p>'+
'<p><b><a name="z692"></a>Статья 92-6. Направление должнику копии исполнительной надписи</b></p><p>1. После совершения исполнительной надписи нотариус направляет ее копию должнику.</p><p>2. Должник вправе в течение десяти рабочих дней со дня получения копии направить мотивированное возражение.</p>'+
'<p><b><a name="z698"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p><p>Нотариус выносит постановление об отмене исполнительной надписи не позднее трех рабочих дней после получения возражения.</p>'+
'<p><b><a name="z700"></a>Статья 92-9. Завершение</b></p><p>Другая статья, которая должна быть отделена от предыдущей, не является частью текста статьи девяносто два восемь.</p></article></html>';
function fixture(url,options){assert.equal(options.redirect,"error");assert.match(url,/^https:\/\/old\.adilet\.zan\.kz\/rus\//);return Promise.resolve(new Response(url.endsWith("/history")?history:article,{headers:{"content-type":"text/html"}}));}
test("historic dates detected but ambiguous timeline and year alone refused",()=>{
  assert.deepEqual(historicalDateHint("Надпись от 18.04.2024",{asOf:"2026-11-21"}),{historical:true,date:"2024-04-18",reason:"dated"});
  assert.equal(historicalDateHint("2024-04-18 и 20.04.2025",{asOf:"2026-11-21"}).reason,"multiple_dates");
  assert.equal(historicalDateHint("надпись 2024 года",{asOf:"2026-11-21"}).reason,"year_without_date");
  assert.equal(historicalDateHint("надпись сегодня",{asOf:"2026-11-21"}).historical,false);
});
test("official archive selected by modification date not later than case event",()=>{
  const dates=parseOfficialHistory(history,"Z970000155_");
  assert.deepEqual(chooseArchiveRevision(dates,"2024-04-18"),{prior:"2023-07-01",next:"2024-07-05"});
  assert.equal(chooseArchiveRevision(dates,"1997-01-01").prior,null);
  assert.throws(()=>parseOfficialHistory(history.replaceAll("Z970000155_","BAD"),"Z970000155_"));
});
test("historical texts have archive links, edition caveat and selected date",async()=>{
  const urls=[];
  const x=await getHistoricalOfficialContext(notary,"Отмена исполнительной надписи нотариуса от 18.04.2024, сроки",{
    asOf:"2026-11-21",fetchImpl:async(url,opts)=>{urls.push(url);return fixture(url,opts);}
  });
  assert.equal(x.historical,true);
  assert.deepEqual(urls,["https://old.adilet.zan.kz/rus/docs/Z970000155_/history","https://old.adilet.zan.kz/rus/archive/docs/Z970000155_/01.07.2023","https://old.adilet.zan.kz/rus/archive/docs/Z970000155_/05.07.2024"]);
  assert.match(x.context,/дата события: 2024-04-18/);
  assert.match(x.context,/2023-07-01/);assert.match(x.context,/2024-07-05/);
  assert.match(x.context,/СТАТЬЯ 92-6/);assert.match(x.context,/СТАТЬЯ 92-8/);
  assert.match(x.context,/НЕ подтверждение даты вступления/);
  assert.match(x.context,/СОПОСТАВЛЕНИЕ ТЕКСТОВ/);
  assert.match(x.context,/текст совпадает в извлечённых редакциях/);
});
test("multiple dates refuse a fabricated operative revision without fetching",async()=>{
  let calls=0;
  const r=await getHistoricalOfficialContext(notary,"Нотариальная исполнительная надпись от 18.04.2024, вручение 18.05.2025",{
    asOf:"2026-11-21",fetchImpl:async()=>{calls++;throw Error("should not fetch");}
  });
  assert.equal(r.historical,true);assert.equal(calls,0);assert.match(r.context,/несколько дат либо указан только год/);
});
test("archive failure never substitutes present-day law for historic event",async()=>{
  const r=await getHistoricalOfficialContext(notary,"Нотариальная исполнительная надпись 18.04.2024",{
    asOf:"2026-11-21",fetchImpl:async()=>{throw Error("network");}
  });
  assert.equal(r.historical,true);assert.match(r.context,/ИСТОРИЧЕСКАЯ ПРОВЕРКА НЕ ЗАВЕРШЕНА/);
});
test("undated question stays on regular official live path",async()=>{
  const r=await getHistoricalOfficialContext(notary,"Отмена исполнительной надписи нотариуса сегодня",{
    asOf:"2026-11-21",fetchImpl:async()=>{throw Error("should not fetch");}
  });
  assert.equal(r.historical,false);
});