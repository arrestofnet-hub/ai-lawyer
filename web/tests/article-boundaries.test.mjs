import test from "node:test";
import assert from "node:assert/strict";
import {extractOfficialArticleBlocks} from "../legal/article-boundaries.mjs";
import {parseOfficialArticles} from "../legal/live-official.mjs";
import {extractArticleAmendmentNotes,buildAmendmentReviewContext} from "../legal/amendment-review.mjs";

// Synthetic fixture reproduces the real 01.07.2023 Әділет markup pattern:
// article 92-8 is followed by Chapter 15 before article 93. Some article
// amendment footnotes are split across separate spans and external anchors.
const html='<!doctype html><html><article>'+
'<p><b><a name="z692"></a>Статья 92-6. Направление должнику копии исполнительной надписи</b></p>'+
'<p id="z693">1. Копия исполнительной надписи направляется должнику в соответствии с требованиями закона и с фиксацией доставки.</p>'+
'<p class="note">Сноска. Заголовок статьи 92-6 с изменениями, внесенными Законом от 15.02.2021 '+
'<a href="/rus/docs/Z2100000005#z269">№ 5-VII</a> (вводится в действие после первого официального опубликования).</p>'+
'<p><b><a name="z698"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>'+
'<p class="note">Сноска. Заголовок статьи 92-8 с изменением, внесенным Законом РК от 15.02.2021 '+
'<a href="/rus/docs/Z2100000005#z283">№ 5-VII</a> (вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования).</p>'+
'<p>1. Нотариус выносит постановление об отмене исполнительной надписи не позднее трех рабочих дней со дня получения возражения против заявленного требования.</p>'+
'<p>2. Постановление об отмене исполнительной надписи оспариванию не подлежит.</p>'+
'<span class="note">Сноска. Статья 92-8 в редакции Закона РК от 21.01.2019 </span>'+
'<a href="/rus/docs/Z1900000217#z345">№ 217-VI</a>'+
'<span class="note"> (вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования); с изменениями, внесенными Законом РК от 15.02.2021 </span>'+
'<a href="/rus/docs/Z2100000005#z282">№ 5-VII</a>'+
'<span class="note"> (вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования).</span><br/>'+
'<h3 id="z180"> Глава 15. ПРИНЯТИЕ НА ХРАНЕНИЕ ДОКУМЕНТОВ И ЦЕННЫХ БУМАГ</h3>'+
'<p class="note">Сноска. Заголовок главы 15 с изменением, внесенным Законом РК от 13.11.1998 '+
'<a href="/rus/docs/Z980000302_#z0">№ 302</a>.</p>'+
'<p><b><a name="z181"></a>Статья 93. Принятие на хранение документов и ценных бумаг</b></p>'+
'<p>Нотариус принимает документы на хранение, а порядок выдачи определяется положениями соответствующей статьи закона.</p>'+
'</article></html>';
const selected=["92-6","92-8"];

test("article block ends at chapter heading BEFORE the next numbered article",()=>{
  const b=extractOfficialArticleBlocks(html);
  const a=b.find(x=>x.article==="92-8");
  assert.ok(a);
  assert.doesNotMatch(a.html,/Глава 15|Z980000302_/);
  assert.match(a.html,/Z1900000217/);
  assert.match(a.html,/Z2100000005/);
  assert.equal(b.find(x=>x.article==="93").article,"93");
});

test("article extraction never includes the next chapter's text or amendment note",()=>{
  const articles=parseOfficialArticles(html,selected);
  assert.deepEqual(articles.map(x=>x.article),selected);
  const a=articles.find(x=>x.article==="92-8");
  assert.match(a.text,/постановление об отмене исполнительной надписи/);
  assert.doesNotMatch(a.text,/Глава 15|Заголовок главы 15|Z980000302_/);
});

test("split-span footnote includes both true amending acts but excludes Chapter 15",()=>{
  const notes=extractArticleAmendmentNotes(html,selected,{actId:"Z970000155_"});
  const a=notes.filter(x=>x.article==="92-8");
  assert.equal(a.length,2);
  assert.deepEqual(a[1].amendingActIds,["Z1900000217","Z2100000005"]);
  assert.equal(a[1].rule.kind,"mixed_rules");
  assert.ok(notes.every(n=>!n.amendingActIds.includes("Z980000302_")));
  assert.ok(notes.every(n=>!n.note.includes("Заголовок главы 15")));
});

test("final Sol citation context never attributes chapter amendment to article 92-8",()=>{
  const articles=parseOfficialArticles(html,selected);
  const review=buildAmendmentReviewContext({
    actId:"Z970000155_",articleNumbers:selected,eventDate:"2024-04-18",
    priorDate:"2023-07-01",nextDate:"2024-07-05",
    priorHtml:html,priorArticles:articles,nextHtml:null,nextArticles:[]
  });
  assert.match(review.context,/Z1900000217/);
  assert.match(review.context,/Z2100000005/);
  assert.doesNotMatch(review.context,/Z980000302_/);
  assert.equal(review.summary.reviewed,false);
});
