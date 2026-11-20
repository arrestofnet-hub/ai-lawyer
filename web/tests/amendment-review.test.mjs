import test from "node:test";
import assert from "node:assert/strict";
import {classifyEntryRule,extractArticleAmendmentNotes,
  compareArchivedArticles,buildAmendmentReviewContext} from "../legal/amendment-review.mjs";
const oldHtml='<html><article>'+
'<p><b><a name="z1"></a>Статья 92-5. Общие сроки</b></p>'+
'<p>Текст с подробными условиями, изложенными в официальной редакции закона, для проверки границ статьи.</p>'+
'<p><b><a name="z2"></a>Статья 92-6. Направление должнику копии исполнительной надписи</b></p>'+
'<p>После совершения исполнительной надписи нотариус направляет ее копию должнику по установленному порядку.</p>'+
'<p class="note">Сноска. Статья 92-6 с изменениями, внесенными Законом РК от 21.01.2019 '+
'<a href="/rus/docs/Z1900000217#z332">№ 217-VI</a> '+
'(вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования).</p>'+
'<p><b><a name="z3"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>'+
'<p>Нотариус выносит постановление об отмене исполнительной надписи при наличии мотивированного возражения.</p>'+
'<span class="note">Сноска. Статья 92-8 в редакции Закона РК от 08.07.2026 '+
'<a href="/rus/docs/Z2600000343#z21">№ 343-VIII</a> '+
'(вводится в действие с 01.01.2027).</span>'+
'<p><b><a name="z4"></a>Статья 92-9. Следующая статья</b></p>'+
'<p>Следующая статья не должна считаться частью предшествующей, что важно при разборе законодательного текста.</p>'+
'</article></html>';
const one={article:"92-6",text:"Статья 92-6. Проверочная строка с текстом"};
const other={article:"92-6",text:"Статья 92-6. Другая редакция и уточнённый порядок"};
test("entry-rule signals distinguish explicit dates, publication-relative and cross references",()=>{
  assert.deepEqual(classifyEntryRule("вводится в действие с 01.01.2027").kind,"date_in_note");
  assert.equal(classifyEntryRule("вводится в действие с 01.01.2027").verified,false);
  assert.equal(classifyEntryRule("вводится в действие по истечении десяти календарных дней после дня первого официального опубликования").kind,"after_publication");
  assert.equal(classifyEntryRule("порядок введения в действие см. ст. 3").kind,"referenced_provision");
  assert.equal(classifyEntryRule("вводится в действие с 01.01.2026; вводится в действие по истечении десяти календарных дней после дня его первого официального опубликования").kind,"mixed_rules");
});
test("official amendment footnotes preserve amending law IDs and prevent cross-act guessed citations",()=>{
  const notes=extractArticleAmendmentNotes(oldHtml,["92-6","92-8"],{actId:"Z970000155_"});
  assert.equal(notes.length,2);
  assert.deepEqual(notes[0].amendingActIds,["Z1900000217"]);
  assert.deepEqual(notes[1].amendingActIds,["Z2600000343"]);
  assert.equal(notes[0].rule.kind,"after_publication");
  assert.equal(notes[1].rule.kind,"date_in_note");
  assert.equal(notes[1].rule.verified,false);
  assert.throws(()=>extractArticleAmendmentNotes("<article>not a full page</article>",["92-6"]));
});
test("text comparison is exact and cannot claim substantive legal difference automatically",()=>{
  assert.equal(compareArchivedArticles([one],[{...one}])[0].status,"same_text");
  assert.equal(compareArchivedArticles([one],[other])[0].status,"different_text");
  assert.equal(compareArchivedArticles([one],[])[0].status,"not_comparable");
});
test("historical amendment review reports amendments as unverified, next edition as textual diff only",()=>{
  const result=buildAmendmentReviewContext({
    actId:"Z970000155_",articleNumbers:["92-6","92-8"],eventDate:"2024-04-18",
    priorDate:"2023-07-01",nextDate:"2024-07-05",priorHtml:oldHtml,
    priorArticles:[one],nextHtml:oldHtml,nextArticles:[other]
  });
  assert.match(result.context,/https:\/\/adilet.zan.kz\/rus\/docs\/Z1900000217/);
  assert.match(result.context,/подтверждённая дата вступления: НЕТ/);
  assert.match(result.context,/первого официального опубликования/);
  assert.match(result.context,/Статья 92-6: текст отличается/);
  assert.equal(result.summary.reviewed,false);
  assert.equal(result.summary.articleFootnotes,2);
  assert.equal(result.summary.comparison[0].status,"different_text");
});
test("unavailable next revision does not silently report unchanged article",()=>{
  const result=buildAmendmentReviewContext({
    actId:"Z970000155_",articleNumbers:["92-6"],eventDate:"2024-04-18",
    priorDate:"2023-07-01",nextDate:"2024-07-05",priorHtml:oldHtml,
    priorArticles:[one],nextHtml:null,nextArticles:[]
  });
  assert.match(result.context,/Не удалось достоверно извлечь следующую версию/);
  assert.equal(result.summary.comparedArticles,0);
});
