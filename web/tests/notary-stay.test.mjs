import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry} from "../legal/sources.mjs";
import {parseCivilProcedureStayProvisions,parseCourtStayProvisions,
  getNotarialCollectionStayContext} from "../legal/notary-stay.mjs";
import {getNotarialCompanionContext} from "../legal/notary-procedure.mjs";

const registry=loadOfficialRegistry(fileURLToPath(new URL("../legal/official-sources.json",import.meta.url)));
const gpk="<html><article>"+
  "<p><b><a name='z155'></a>Статья 155. Основания для обеспечения иска</b></p>"+
  "<p>Суд применяет обеспечение иска, когда непринятие такой меры затруднит исполнение судебного решения по делу, обоснованно связанному со спором.</p>"+
  "<p><b><a name='z156'></a>Статья 156. Меры по обеспечению иска</b></p>"+
  "<p>1. Мерами по обеспечению иска могут быть различные меры, которые соответствуют предмету возникшего спора и правилам гражданского судопроизводства.</p>"+
  "<p>5) приостановление действия оспариваемого акта уполномоченного органа в строго предусмотренных законодательством случаях;</p>"+
  "<p>6) приостановление взыскания по исполнительному документу, оспариваемому ответчиком в судебном порядке;</p>"+
  "<p>8) приостановление оспариваемых актов и действий судебного исполнителя, связанных с обращением взыскания на имущество, совершаемых в исполнительном производстве.</p>"+
  "<p><b><a name='z157'></a>Статья 157. Рассмотрение заявления об обеспечении иска</b></p>"+
  "<p>1. Заявление об обеспечении иска рассматривается и разрешается судьей в день вынесения определения о возбуждении гражданского дела, если оно было приложено к иску или об этом указано в иске. В остальных случаях заявление об обеспечении иска разрешается судьей в день его поступления в суд.</p>"+
  "<p>2. Заявление об обеспечении иска рассматривается и разрешается судьей без извещения лиц, участвующих в деле, без проведения судебного заседания. По результатам рассмотрения заявления судья выносит определение об обеспечении иска или об отказе в удовлетворении заявления.</p>"+
  "<p><b><a name='z158'></a>Статья 158. Исполнение определения об обеспечении иска</b></p>"+
  "<p>1. Определение суда направляется судом или вручается лицу, заявившему ходатайство, для немедленного представления уполномоченным органам.</p>"+
  "<p>2) в соответствующий орган юстиции либо в региональную палату частных судебных исполнителей по территориальности для приостановления исполнительного производства в случаях, предусмотренных подпунктами 6), 8) части первой статьи 156 настоящего Кодекса;</p>"+
  "<p><b><a name='z159'></a>Статья 159. Продолжение</b></p>"+
  "<p>Следующая статья должна быть отделена от предыдущей, чтобы не искажать порядок приостановления взыскания и полномочия суда.</p>"+
  "<p><b><a name='z364'></a>Статья 364. Подача жалобы на нотариальное действие</b></p>"+
  "<p>Заинтересованное лицо вправе в установленном процессуальном порядке обратиться в суд с жалобой на нотариальное действие в течение десятидневного срока, который необходимо правильно исчислять.</p>"+
  "</article></html>";
const np="<html><article>"+
  "<p id='z23'>Суд обязан правильно устанавливать предмет иска о нотариальной исполнительной надписи и сохранять возможность судебного контроля.</p>"+
  "<p id='z24'>Если на момент подачи жалобы на нотариальное действие или иска о признании исполнительной надписи, не подлежащей исполнению, возбуждено исполнительное производство, заявитель (истец) вправе обратиться в суд с заявлением о принятии мер по обеспечению иска - о приостановлении взыскания по исполнительной надписи.</p>"+
  "<p id='z25'>Не нужно заменять судебную обеспечительную меру самостоятельным требованием к судебному исполнителю без законного основания.</p>"+
  "</article></html>";
const notary="<html><article>"+
  "<p><b><a name='z50'></a>Статья 92-6. Порядок направления копии исполнительной надписи</b></p>"+
  "<p>Должнику направляется копия исполнительной надписи с учетом предусмотренного законом порядка надлежащего направления и фиксации доставки.</p>"+
  "<p><b><a name='z51'></a>Статья 92-8. Отмена и оспаривание исполнительной надписи</b></p>"+
  "<p>При определенных условиях нотариус принимает решение об отмене исполнительной надписи, а также указывается возможность судебного оспаривания.</p>"+
  "<p><b><a name='z52'></a>Статья 92-9. Дополнительные правила</b></p>"+
  "<p>Соседняя статья, которая обеспечивает юридическую правильность разделения официально опубликованного текста.</p>"+
  "</article></html>";
test("GPK articles 156(1)(6),157,158(1)(2) are separately and accurately extracted",()=>{
  const x=parseCivilProcedureStayProvisions(gpk);
  assert.match(x.article156,/^6\) приостановление взыскания/);
  assert.match(x.article157,/в день его поступления в суд/);
  assert.match(x.article157,/без извещения лиц/);
  assert.match(x.article158,/региональную палату частных судебных исполнителей/);
  assert.match(x.urls.article156,/K1500000377#z156/);
});
test("only exact Supreme Court stay statement is extracted; no invented bailiff power",()=>{
  const x=parseCourtStayProvisions(np);
  assert.match(x.text,/заявитель \(истец\) вправе обратиться в суд/);
  assert.match(x.url,/P220000006S#z24/);
  assert.throws(()=>parseCourtStayProvisions(np.replace("возбуждено исполнительное производство","производство не возбуждалось")));
});
test("integrated judicial stay context has all official sources and no automatic stay promises",async()=>{
  const urls=[];
  const text=await getNotarialCollectionStayContext({
    asOf:"2026-11-21",fetchImpl:async(url,opt)=>{
      urls.push(url);assert.equal(opt.redirect,"error");
      return new Response(url.includes("K1500000377")?gpk:np,{headers:{"content-type":"text/html"}});
    }
  });
  assert.deepEqual(new Set(urls),new Set([
    "https://old.adilet.zan.kz/rus/docs/K1500000377",
    "https://old.adilet.zan.kz/rus/docs/P220000006S"
  ]));
  assert.match(text,/статьи 156/);
  assert.match(text,/статьи 158/);
  assert.match(text,/Нормативное постановление ВС № 6/);
  assert.match(text,/жалоба и ходатайство сами по себе НЕ приостанавливают исполнение/i);
  assert.match(text,/орган юстиции/);
});
test("unavailable source is explicitly marked unverified; partial context remains",async()=>{
  const text=await getNotarialCollectionStayContext({
    fetchImpl:async(url)=>{
      if(url.includes("P220000006S"))throw Error("Offline");
      return new Response(gpk,{headers:{"content-type":"text/html"}});
    }
  });
  assert.match(text,/подпункт 6\) части 1 статьи 156/);
  assert.match(text,/не подтверждено/);
});
test("companion source fetches same official URLs only once despite two consumers",async()=>{
  const called=[];
  const text=await getNotarialCompanionContext(registry,
    "Отмена исполнительной надписи нотариуса, статья 364 ГПК и обеспечительная мера",{
      asOf:"2026-11-21",verify343:false,
      fetchImpl:async(url,opt)=>{
        called.push(url);
        assert.equal(opt.redirect,"error");
        const body=url.endsWith("K1500000377")?gpk:
          url.endsWith("P220000006S")?np:notary;
        return new Response(body,{headers:{"content-type":"text/html"}});
      }
    });
  assert.equal(called.length,3);
  assert.equal(called.filter(x=>x.endsWith("K1500000377")).length,1);
  assert.equal(called.filter(x=>x.endsWith("P220000006S")).length,1);
  assert.match(text,/ОСОБЫЙ ВОПРОС: ПРИОСТАНОВЛЕНИЕ ВЗЫСКАНИЯ/);
});
