// Source-specific, narrowly scoped official amendment review for the GK
// revision observed on 09.04.2025. Do not infer amendments or enactment
// merely from the version timestamp: read the actual changing law and its
// separate official publication metadata.
import {fetchOfficialLaw,parseOfficialPublicationMetadata,
  parseAmendingLawEnactment,addDays} from "./publication.mjs";

const ACT="Z2500000179";
const ROOT="https://old.adilet.zan.kz/rus/docs/"+ACT;
const SUBJECT=["339","341","342","343","345","346"];

function textOnly(html){
  return String(html||"").replace(/<[^>]*>/g," ")
    .replace(/&nbsp;|&#160;/gi," ").replace(/\s+/g," ").trim();
}
export function parseGk2025Law179Scope(html){
  const body=String(html||"").match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!body||!body.includes("/rus/docs/K940001000_")||
     !/Статья\s+1\./iu.test(body))throw Error("Official amending law missing");
  const articleOne=body.slice(0,body.search(/Статья\s+2\./iu));
  // Locate EXACT GK amendment subitem within article 1; the next numbered
  // subitem changes the Land Code, not the Civil Code.
  const m=articleOne.match(/<p\b[^>]*>\s*1\.\s*В\s*<a\s+href=["']\/rus\/docs\/K940001000_[^"']*["'][^>]*>[\s\S]*?<\/p>/i);
  if(!m)throw Error("Civil Code amendment subitem not located");
  const start=m.index;
  const tail=articleOne.slice(start+m[0].length);
  const next=tail.search(/<p\b[^>]*>\s*2\.\s*В\s*<a\s+href=["']\/rus\/docs\/K030000442_/i);
  if(next<0||next>15000)throw Error("Amendment scope boundary unconfirmed");
  const scope=textOnly(articleOne.slice(start,start+m[0].length+next));
  // Only recognize explicit statutory-article references within this
  // source subsection. Fail closed if the expected identities disappear.
  const changed=[...new Set([...scope.matchAll(
    /(?:статье|статьи|статью|статья)\s+(\d+(?:-\d+)?)/giu
  )].map(m=>m[1]))];
  if(changed.length!==2||!changed.includes("193-1")||!changed.includes("242"))
    throw Error("Unable to confirm specific changed GK articles");
  return {changedArticles:changed,unaffectedInThisLaw:SUBJECT.filter(n=>!changed.includes(n)),
    lawUrl:ROOT,scopeExcerpt:scope.slice(0,1500)};
}

export async function getGk2025Law179ImpactContext({
  fetchImpl=fetch
}={}){
  if(process.env.OFFICIAL_PUBLICATION_REVIEW_ENABLED==="0")return "";
  let law,info,scope,enactment,pub;
  try{
    [law,info]=await Promise.all([
      fetchOfficialLaw(ROOT,fetchImpl),
      fetchOfficialLaw(ROOT+"/info",fetchImpl)
    ]);
    scope=parseGk2025Law179Scope(law);
    enactment=parseAmendingLawEnactment(law,{actId:ACT});
    pub=parseOfficialPublicationMetadata(info,{actId:ACT});
  }catch{
    return "\nОТДЕЛЬНАЯ ПРОВЕРКА ЗАКОНА РК № 179-VIII ОТ 09.04.2025 НЕ ЗАВЕРШЕНА. "+
      "Нельзя выводить срок вступления из даты архивной редакции. "+
      "Нормативный текст: "+ROOT+"; официальная публикация: "+ROOT+"/info.";
  }
  const candidate=enactment.calendarDays===60?
    addDays(pub.firstReportedPublication,61):null;
  const exceptionScope=/подпункта\s+1\)\s+пункта\s+18\s+статьи\s+1/iu.test(enactment.enactmentExcerpt);
  const publicationMatches=pub.firstReportedPublication==="2025-04-10";
  return "\nПРЕДМЕТНАЯ ПРОВЕРКА ИЗМЕНЯЮЩЕГО ЗАКОНА № 179-VIII ОТ 09.04.2025:"+
    "\nОфициальный закон: "+ROOT+"; сведения о публикации: "+ROOT+"/info."+
    "\nВ статье 1 этого конкретного изменяющего закона в ГК (Общая часть) "+
    "названы статьи: "+scope.changedArticles.join(", ")+
    ". Исследуемые статьи "+SUBJECT.join(", ")+" в этом пункте НЕ изменяются. "+
    "Это НЕ подтверждает отсутствие иных изменяющих законов."+
    "\nСведения Әділет о первой официальной публикации: "+
    pub.firstReportedPublication+
    " (остальные упомянутые даты: "+pub.reportedDates.join(", ")+")."+
    "\nОбщее правило статьи "+(enactment.article||"?")+
    ": "+(enactment.calendarDays===null?"не извлечено":
      enactment.calendarDays+" календарных дней по истечении после первого официального опубликования")+
    "; предварительно рассчитанная дата по общему правилу: "+
    (candidate||"НЕ УСТАНОВЛЕНА")+". "+
    (publicationMatches?"Первое опубликование указано 10.04.2025. ":
      "Не подтверждена ожидаемая дата первой публикации. ")+
    (exceptionScope?"В законе установлено исключение для подпункта 1) "+
      "пункта 18 статьи 1 (требуется самостоятельная проверка его предмета). ":
      enactment.exceptionsPresent?"В законе предусмотрены исключения, "+
      "сфера применения не установлена. ":"")+
    "\nНа 10.04.2025 дата внесения изменений в архив ГК НЕ означает, "+
    "что поправка уже действовала. Исходный текст шести статей "+
    "339–346 сверяется отдельно по официальным архивным версиям."+
    "\nЮридическое действие, исключения и применимость поправок "+
    "к фактам дела автоматически окончательно НЕ подтверждены. "+
    "Индивидуальная газетная публикация не проверена отдельно.";
}
