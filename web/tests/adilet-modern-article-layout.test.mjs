import test from "node:test";
import assert from "node:assert/strict";
import {extractOfficialArticleBlocks} from "../legal/article-boundaries.mjs";
import {parseOfficialArticles,getLiveOfficialArticleContext} from "../legal/live-official.mjs";

const general=[{
  id:"gk-general",actId:"K940001000_",
  title:"Гражданский кодекс Республики Казахстан (Общая часть)",
  officialUrl:"https://adilet.zan.kz/rus/docs/K940001000_",
  keywords:["цесс","уступк","право требования"]
}];
const parts=[
  ["339","z716","Основания и порядок перехода прав кредитора к другому лицу",
   "1. Право (требование), принадлежащее кредитору на основании обязательства, может быть передано другому лицу по сделке (уступка требования) или перейти к другому лицу на основании закона. 3. Если должник не был письменно уведомлен о переходе права, исполнение прежнему кредитору признаётся надлежащим."],
  ["340","z718","Права, которые не могут переходить к другим лицам",
   "Переход к другому лицу прав, неразрывно связанных с личностью кредитора, включая алименты, не допускается законодательством Республики Казахстан."],
  ["341","z720","Объем прав кредитора, переходящих к другому лицу",
   "Если иное не предусмотрено законодательством или договором, права кредитора переходят к новому в существовавшем объёме и на существовавших условиях, вместе с обеспечивающими правами."],
  ["342","z5959","Доказательства прав нового кредитора",
   "1. Должник вправе не исполнять обязательство новому кредитору до представления доказательств перехода требования к этому лицу. 2. Уступивший требование кредитор обязан передать документы, удостоверяющие право требования."],
  ["343","z5960","Возражения должника против требования нового кредитора",
   "Должник вправе предъявлять новому кредитору возражения, которые имел к первоначальному кредитору на момент получения уведомления о переходе прав по обязательству."],
  ["344","z723","Переход прав кредитора к другому лицу на основании законов",
   "Права кредитора переходят к другому лицу в предусмотренных законодательством случаях, включая универсальное правопреемство и установленные законом основания."],
  ["345","z725","Условия уступки требования",
   "1. Уступка требования кредитором другому лицу допускается, поскольку она не противоречит законодательству или договору. 2. Без согласия должника недопустима уступка, когда личность кредитора имеет существенное значение."],
  ["346","z727","Форма уступки требования",
   "1. Уступка требования, основанного на письменной сделке, должна быть совершена в соответствующей письменной форме. 2. Уступка по сделке, требующей регистрации, должна быть зарегистрирована в соответствующем порядке."],
  ["347","z729","Ответственность кредитора, уступившего требование",
   "Первоначальный кредитор несёт ответственность за действительность переданного требования; эта следующая статья не должна попасть в предыдущую."]
];
const html="<html><article><h3 id=\"z714\">Глава 19. Перемена лиц в обязательстве</h3>"+
  parts.map(([n,id,title,body])=>"<h3 id=\""+id+"\"> Статья "+n+". "+title+" </h3><p>"+body+"</p>").join("")+
  "</article></html>";
const prompt="Уступка права требования по займу: статьи 339, 341, 342, 343, 345, 346 ГК РК";

test("new official Әділет h3 headings extract all 6 provisions without adjoining article text",()=>{
  const blocks=extractOfficialArticleBlocks(html);
  assert.deepEqual(blocks.map(b=>b.article),parts.map(p=>p[0]));
  const articles=parseOfficialArticles(html,["339","341","342","343","345","346"]);
  assert.deepEqual(articles.map(a=>a.article),["339","341","342","343","345","346"]);
  assert.equal(articles[0].anchor,"z716");
  assert.equal(articles[2].anchor,"z5959");
  assert.match(articles[2].text,/не исполнять обязательство новому кредитору/);
  assert.doesNotMatch(articles[2].text,/Статья 343/);
  assert.doesNotMatch(articles.at(-1).text,/Статья 347/);
  assert.ok(articles.every(a=>/^[a-f0-9]{64}$/.test(a.sha256)));
});

test("official current page passes 6/6 without requesting alternate site",async()=>{
  const calls=[];
  const ctx=await getLiveOfficialArticleContext(general,prompt,{
    asOf:"2026-11-22",fetchImpl:async(url,opts)=>{
      calls.push(url);assert.equal(opts.redirect,"error");
      return new Response(html,{headers:{"content-type":"text/html"}});
    }
  });
  assert.deepEqual(calls,["https://old.adilet.zan.kz/rus/docs/K940001000_"]);
  for(const n of [339,341,342,343,345,346])assert.match(ctx,new RegExp("СТАТЬЯ "+n+";"));
  assert.match(ctx,/НЕ ИСТОРИЧЕСКАЯ РЕДАКЦИЯ/);
});

test("exact GK comparison URL is an explicit fallback when current page fails",async()=>{
  const calls=[];
  const ctx=await getLiveOfficialArticleContext(general,prompt,{
    fetchImpl:async(url,opts)=>{
      calls.push(url);assert.equal(opts.redirect,"error");
      if(url==="https://old.adilet.zan.kz/rus/docs/K940001000_")
        throw new Error("large page unavailable");
      if(url!=="https://old.adilet.zan.kz/rus/docs/K940001000_/compare")
        throw new Error("unexpected fallback "+url);
      return new Response(html,{headers:{"content-type":"text/html"}});
    }
  });
  assert.deepEqual(calls,[
    "https://old.adilet.zan.kz/rus/docs/K940001000_",
    "https://old.adilet.zan.kz/rus/docs/K940001000_/compare"
  ]);
  for(const n of [339,341,342,343,345,346])assert.match(ctx,new RegExp("СТАТЬЯ "+n+";"));
  assert.match(ctx,/СРАВНИТЕЛЬНОЙ страницы/);
  assert.match(ctx,/НЕ доказательство/);
  assert.match(ctx,/исторической редакции/);
});

test("fail closed if no complete official law articles can be parsed",async()=>{
  const failed=await getLiveOfficialArticleContext(general,prompt,{
    fetchImpl:async()=>{throw new Error("offline");}
  });
  assert.match(failed,/онлайн-текст нужных статей Әділет недоступен/);
  assert.doesNotMatch(failed,/СТАТЬЯ 339;/);
  const toc="<article><h3 id='z716'>Статья 339. Основания и порядок перехода прав кредитора</h3></article>";
  assert.throws(()=>parseOfficialArticles(toc,["339"]));
});
