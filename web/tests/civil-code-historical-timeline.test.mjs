import test from "node:test";
import assert from "node:assert/strict";
import {parseOfficialHistory,chooseArchiveRevision,
  getCivilAssignmentArchiveTimeline,getTimelineOfficialContext}
  from "../legal/historical.mjs";

const gk=[{
  id:"gk-general",title:"Гражданский кодекс Республики Казахстан (Общая часть)",
  actId:"K940001000_",officialUrl:"https://adilet.zan.kz/rus/docs/K940001000_",
  historyUrl:"https://adilet.zan.kz/rus/docs/K940001000_/history",
  keywords:["гк","цесс","уступк","переход права требования"]
}];

const dates=["01.09.2024","09.04.2025","10.06.2025"];
const history="<html><h1>Гражданский кодекс Республики Казахстан (Общая часть)</h1>"+
  "<p>Кодекс Республики Казахстан от 27 декабря 1994 года № 268-XIII.</p>"+
  "<p>История изменений</p><table><tr><th>№</th><th>Заголовок</th>"+
  "<th>Форма НПА и орган</th><th>Официальная публикация</th>"+
  "<th>Дата изменения</th><th>Статус НПА</th></tr>"+
  dates.map((d,i)=>
    "<tr><td>"+(172+i)+"</td><td>Гражданский кодекс Республики Казахстан</td>"+
    "<td>Кодекс Республики Казахстан от 27 декабря 1994 года № 268-XIII.</td>"+
    "<td>Ведомости Верховного Совета Республики Казахстан</td>"+
    "<td>"+d+"</td><td>Обновленный</td></tr>").join("")+
  "<tr><td>test</td><td>ДРУГОЙ ЗАКОН</td><td>1994</td><td>source</td>"+
  "<td>15.03.2025</td><td>Обновленный</td></tr></table></html>";
const wanted=["339","341","342","343","345","346"];
const articles=[
  ["339","Основания и порядок перехода прав кредитора к другому лицу",
    "Право требования может быть передано другому лицу по сделке уступки требования или перейти на основании закона, и должник должен иметь возможность проверить сведения об уведомлении."],
  ["340","Права, которые не могут переходить к другим лицам",
    "Права, неразрывно связанные с личностью кредитора, не могут переходить другому лицу в рамках действующего гражданского законодательства."],
  ["341","Объем прав кредитора, переходящих к другому лицу",
    "Объем прав нового кредитора определяется договором и законодательством, включая правила о переходе обеспечения и существующих условий требования."],
  ["342","Доказательства прав нового кредитора",
    "Должник вправе не исполнять обязательство новому кредитору до представления ему доказательств перехода требования к этому лицу, которые необходимо исследовать."],
  ["343","Возражения должника против требования нового кредитора",
    "Должник может выдвигать против нового кредитора возражения, имевшиеся против первоначального кредитора к моменту получения уведомления о переходе прав."],
  ["344","Переход прав кредитора на основании законов",
    "Перемена кредитора возможна в предусмотренных законом случаях, независимо от согласия должника при соблюдении условий самого правового основания."],
  ["345","Условия уступки требования",
    "Уступка допускается, если она не противоречит договору или законодательству, а также предусмотренным ограничениям, включая личность кредитора."],
  ["346","Форма уступки требования",
    "Уступка права, основанного на письменной сделке, должна совершаться в соответствующей письменной форме, а при необходимости также регистрироваться."],
  ["347","Ответственность первоначального кредитора",
    "Следующая отдельная статья регулирует иные правовые последствия и не должна попадать в текст предыдущей статьи."]
];
const archive2024="<html><article>"+
  articles.map(([n,title,body],i)=>
    '<h3 id="z'+(715+i)+'"> Статья '+n+". "+title+"</h3><p>"+body+"</p>").join("")+
  "</article></html>";
const archive2025=archive2024;
const prompt="Уступка права требования: соглашение от 12.03.2025, уведомление 25.03.2025, оплата 08.04.2025, бухгалтерия 10.04.2025. Применить статьи 339,341,342,343,345,346 ГК РК.";
function mock(url,opts){
  assert.equal(opts.redirect,"error");
  assert.match(url,/^https:\/\/old\.adilet\.zan\.kz\/rus\/(?:docs|archive\/docs)\//);
  const html=url.endsWith("/history")?history:
    url.endsWith("01.09.2024")?archive2024:
    url.endsWith("09.04.2025")?archive2025:null;
  if(html===null)throw Error("Unexpected URL "+url);
  return Promise.resolve(new Response(html,{headers:{"content-type":"text/html"}}));
}

test("official GK normalized history rows work without ethernatable or archive links",()=>{
  const parsed=parseOfficialHistory(history,"K940001000_");
  assert.deepEqual(parsed,["2024-09-01","2025-04-09","2025-06-10"]);
  assert.deepEqual(chooseArchiveRevision(parsed,"2025-03-12"),
    {prior:"2024-09-01",next:"2025-04-09"});
  assert.deepEqual(chooseArchiveRevision(parsed,"2025-04-10"),
    {prior:"2025-04-09",next:"2025-06-10"});
  assert.throws(()=>parseOfficialHistory(history.replace("История изменений",
    "Без истории"),"K940001000_"));
  assert.throws(()=>parseOfficialHistory(history,"Z970000155_"));
});

test("all four legal events map to two official GK archived editions, fetched once each",async()=>{
  const calls=[];
  const r=await getCivilAssignmentArchiveTimeline(gk,prompt,{
    asOf:"2026-11-22",fetchImpl:(u,o)=>{calls.push(u);return mock(u,o);}
  });
  assert.equal(r.historical,true);
  assert.deepEqual(r.comparedDates,[
    "2025-03-12","2025-03-25","2025-04-08","2025-04-10"
  ]);
  assert.deepEqual(r.archiveDates,["2024-09-01","2025-04-09"]);
  assert.deepEqual(calls,[
    "https://old.adilet.zan.kz/rus/docs/K940001000_/history",
    "https://old.adilet.zan.kz/rus/archive/docs/K940001000_/01.09.2024",
    "https://old.adilet.zan.kz/rus/archive/docs/K940001000_/09.04.2025"
  ]);
  for(const n of wanted)assert.match(r.context,new RegExp("СТАТЬЯ "+n));
  assert.match(r.context,/текст совпадает в выбранных архивных версиях/);
  assert.match(r.context,/ПРАВОВОЕ ОГРАНИЧЕНИЕ/);
  assert.match(r.context,/НЕ удостоверяет дату вступления/);
  assert.doesNotMatch(r.context,/СТАТЬЯ 347/);
  assert.ok(!r.context.includes("15.03.2025"));
});

test("timeline context chooses the specialized full-event comparison for cession",async()=>{
  const r=await getTimelineOfficialContext(gk,prompt,{
    asOf:"2026-11-22",publicationReview:false,fetchImpl:mock
  });
  assert.deepEqual(r.comparedDates,[
    "2025-03-12","2025-03-25","2025-04-08","2025-04-10"
  ]);
  assert.match(r.context,/Событие 2025-03-12: архивная версия 2024-09-01/);
  assert.match(r.context,/Событие 2025-04-10: архивная версия 2025-04-09/);
});

test("differing article texts must be reported instead of concealed by a generic same-version claim",async()=>{
  const changed=archive2024.replace(
    "Объем прав нового кредитора определяется договором и законодательством",
    "Редакция 2024 отдельно регулирует объем переданного права по договору");
  const r=await getCivilAssignmentArchiveTimeline(gk,prompt,{
    asOf:"2026-11-22",fetchImpl:(u,o)=>{
      if(u.endsWith("01.09.2024"))
        return Promise.resolve(new Response(changed,{headers:{"content-type":"text/html"}}));
      return mock(u,o);
    }
  });
  assert.match(r.context,/СТАТЬЯ 341: ТЕКСТЫ РАЗЛИЧАЮТСЯ/);
  assert.match(r.context,/Версия 2024-09-01/);
  assert.match(r.context,/Версия 2025-04-09/);
  assert.match(r.context,/архивной версии Әділет/);
});

test("offline history/archive fails closed instead of claiming historical legal force",async()=>{
  const r=await getCivilAssignmentArchiveTimeline(gk,prompt,{
    fetchImpl:async()=>{throw Error("source offline");}
  });
  assert.match(r.context,/ПРОВЕРКА АРХИВОВ ГК ПО ДАТАМ СОБЫТИЙ НЕ ЗАВЕРШЕНА/);
  assert.doesNotMatch(r.context,/СТАТЬЯ 339: текст совпадает/);
  const r2=await getCivilAssignmentArchiveTimeline(gk,prompt,{
    fetchImpl:async(u,o)=>{
      if(u.endsWith("/history"))return mock(u,o);
      return new Response("<html>Forbidden</html>",{headers:{"content-type":"text/html"}});
    }
  });
  assert.match(r2.context,/не извлечена из всех выбранных/);
  assert.doesNotMatch(r2.context,/СТАТЬЯ 342: текст совпадает/);
});
