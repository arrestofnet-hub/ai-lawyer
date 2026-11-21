import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry} from "../legal/sources.mjs";
import {getNotarialCompanionContext,extractCourtInstruction,isNotarialInscriptionQuestion} from "../legal/notary-procedure.mjs";

const laws=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
const notaryHtml='<html><article>'+
  '<p><b><a name="z98"></a>Статья 92-6. Направление копии исполнительной надписи</b></p>'+
  '<p>Нотариус направляет должнику копию исполнительной надписи с подтверждением направления и вручения в соответствии с применимой нормой закона.</p>'+
  '<p><b><a name="z100"></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>'+
  '<p>Нотариус принимает решение об отмене надписи при наличии соответствующего возражения, которое получено с соблюдением установленного законом порядка.</p>'+
  '<p>В случае если совершенная исполнительная надпись не отменена и (или) передана судебному исполнителю на принудительное исполнение, ее оспаривание осуществляется в судебном порядке.</p>'+
  '<p><b><a name="z101"></a>Статья 92-9. Другая нотариальная норма</b></p>'+
  '<p>Другая статья, которая не может подменять проверяемое правило, служит разделителем для корректного парсинга официальных норм.</p>'+
  '</article></html>';
const gpkHtml='<html><article>'+
  '<p><b><a name="z400"></a>Статья 363. Подготовка к рассмотрению жалобы</b></p>'+
  '<p>Стороны вправе представлять документы и доказательства в соответствии с правилами гражданского судопроизводства Республики Казахстан.</p>'+
  '<p><b><a name="z401"></a>Статья 364. Подача жалобы на нотариальное действие</b></p>'+
  '<p>Заинтересованное лицо вправе обратиться в суд с жалобой на нотариальное действие в установленном законом порядке и с соблюдением подсудности.</p>'+
  '<p>Жалоба подается в суд в десятидневный срок со дня, когда заявителю стало известно о совершенном нотариальном действии либо об отказе.</p>'+
  '<p><b><a name="z402"></a>Статья 365. Рассмотрение жалобы</b></p>'+
  '<p>Заявитель вправе участвовать при рассмотрении жалобы и представлять доказательства в порядке, установленном законом.</p>'+
  '</article></html>';
const courtHtml='<html><article>'+
  '<p>Нормативное постановление Верховного Суда Республики Казахстан от 26 мая 2022 года № 6.</p>'+
  '<p>В соответствии с частью четвертой статьи 364 ГПК жалоба подается в суд в десятидневный срок, исчисляемый со дня, когда заявителю стало известно о совершенном нотариальном действии или отказе.</p>'+
  '<p>Отсутствие уточнения в части четвертой статьи 364 ГПК об исчислении в рабочих днях, указание десятидневного срока свидетельствует об исчислении его в календарных днях.</p>'+
  '<p>При решении вопроса о судебном оспаривании суд обязан выяснять содержание возражения должника, а также характер заявленного требования.</p>'+
  '</article></html>';
function sourceFor(url){
  if(url.endsWith("/Z970000155_"))return notaryHtml;
  if(url.endsWith("/K1500000377"))return gpkHtml;
  if(url.endsWith("/P220000006S"))return courtHtml;
  throw Error("Unrecognized official URL: "+url);
}
test("notarial court procedure is triggered only for executive inscription questions",()=>{
  assert.equal(isNotarialInscriptionQuestion("Отмена исполнительной надписи нотариуса"),true);
  assert.equal(isNotarialInscriptionQuestion("Судебное оспаривание исполнительной надписи"),true);
  assert.equal(isNotarialInscriptionQuestion("Кредитные вопросы"),false);
});
test("official court resolution extracts distinct ten-calendar-day explanation",()=>{
  const chunks=extractCourtInstruction(courtHtml);
  assert.equal(chunks.length,2);
  assert.match(chunks[0],/частью четвертой статьи 364/);
  assert.match(chunks[1],/в календарных днях/);
  assert.throws(()=>extractCourtInstruction('<article>not a legal text</article>'));
});
test("live official context brings current notarial clause and separate GPK/VS court deadlines",async()=>{
  const seen=[];
  const text=await getNotarialCompanionContext(laws,
    "Отмена исполнительной надписи нотариуса: статья 92-8, ГПК 364 и НП ВС №6",{
      asOf:"2026-11-21",verify343:false,fetchImpl:async(url,opts)=>{
        seen.push(url);assert.equal(opts.redirect,"error");
        assert.match(url,/^https:\/\/old\.adilet\.zan\.kz\/rus\/docs\//);
        return new Response(sourceFor(url),{
          status:200,headers:{"content-type":"text/html; charset=utf-8"}});
      }
    });
  assert.deepEqual(new Set(seen),new Set([
    "https://old.adilet.zan.kz/rus/docs/Z970000155_",
    "https://old.adilet.zan.kz/rus/docs/K1500000377",
    "https://old.adilet.zan.kz/rus/docs/P220000006S"
  ]));
  assert.match(text,/передана судебному исполнителю на принудительное исполнение/);
  assert.match(text,/ГПК РК — СТАТЬЯ 364/);
  assert.match(text,/НОРМАТИВНОЕ ПОСТАНОВЛЕНИЕ ВЕРХОВНОГО СУДА/);
  assert.match(text,/в календарных днях/);
  assert.match(text,/НЕ самостоятельная проверка исторической редакции/);
});
test("unavailable court resolution fails closed, but independently retrieved statutes remain usable",async()=>{
  const text=await getNotarialCompanionContext(laws,
    "Исполнительная надпись нотариуса",{
      asOf:"2026-11-21",verify343:false,fetchImpl:async(url)=>{
        if(url.endsWith("/P220000006S"))throw Error("not available");
        return new Response(sourceFor(url),{headers:{"content-type":"text/html"}});
      }
    });
  assert.match(text,/СТАТЬЯ 92-8/);
  assert.match(text,/НП ВС № 6: полный текст судебных разъяснений сейчас не получен/);
  assert.doesNotMatch(text,/Пункт-фрагмент 1/);
});
test("unrelated case does not trigger three external law fetches",async()=>{
  let called=false;
  const text=await getNotarialCompanionContext(laws,"Как рассчитываются налоги ИП?",{
    fetchImpl:async()=>{called=true;throw Error("not expected");}
  });
  assert.equal(text,"");assert.equal(called,false);
});
