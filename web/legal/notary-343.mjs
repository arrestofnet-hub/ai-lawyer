// Exact commencement check for Article 92-8 amendments in Law № 343-VIII.
// Unlike a generic archive date, this checks the actual amending subitem (37)
// against the expressly delayed subitems (4 and 34) in Article 2.
// Only approved official Әділет pages can be requested.
import {
  parseOfficialPublicationMetadata,
  parseAmendingLawEnactment,
  fetchOfficialLaw,
  addDays
} from "./publication.mjs";

const ACT="Z2600000343";
const BASE="https://old.adilet.zan.kz/rus/docs/"+ACT;
function plain(s){
  return String(s).replace(/<[^>]*>/g," ")
    .replace(/&nbsp;|&#160;|\u00a0/g," ")
    .replace(/\s+/g," ").trim();
}
export function verifyNotarialAmendment343(lawHtml,infoHtml){
  const pub=parseOfficialPublicationMetadata(infoHtml,{actId:ACT});
  const enactment=parseAmendingLawEnactment(lawHtml,{actId:ACT});
  if(enactment.article!=="2"||enactment.calendarDays!==60||
     !enactment.exceptionsPresent)throw Error("Unverified commencement rule");
  const body=lawHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!body)throw Error("Full official law text missing");
  const paragraphs=[...body.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
    .map(x=>plain(x[0]));
  const position=paragraphs.findIndex(p=>/^37\)\s+в\s+статье\s+92-8:/iu.test(p));
  if(position<1)throw Error("Article 92-8 amendment not found");
  const change=paragraphs.slice(position,position+4).join("\n");
  if(!/пункт\s+1\s+дополнить\s+частью\s+второй/iu.test(change)||
     !/часть\s+третью\s+пункта\s+2/iu.test(change)||
     !/и\s*\(или\)\s+передана\s+судебному\s+исполнителю\s+к\s+принудительному\s+исполнению/iu.test(change))
    throw Error("Article 92-8 change not matched precisely");
  // Verify this is under point 3 of Article 1 (the amendment to the
  // Notaries Act), not an identically numbered item in another law.
  const preceding=paragraphs.slice(Math.max(0,position-40),position).join(" ");
  if(!/3\.\s+В\s+Закон\s+Республики\s+Казахстан\s+от\s+14\s+июля\s+1997\s+года/iu.test(preceding)||
     !/О\s+нотариате/iu.test(preceding))
    throw Error("Amendment's target act and point 3 not verified");

  // Article 2 is explicit: only clauses in subitems 4 and 34 of point 3
  // have a deferred 01.01.2027 date, not subitem 37.
  const clause=enactment.enactmentExcerpt.split(/\n\s*2\.\s+Установить/u)[0];
  const exception=clause.match(/за\s+исключением\s+(.{1,550}?)\s+которые\s+вводятся\s+в\s+действие\s+с\s+1\s+января\s+2027\s+года/iu);
  if(!exception)throw Error("Specific deferred amendments not confirmed");
  const exceptions=[...exception[1].matchAll(/подпункт[а-я]*\s+(\d+)\)/giu)]
    .map(m=>Number(m[1]));
  if(exceptions.length!==2||exceptions[0]!==4||exceptions[1]!==34||
     exceptions.includes(37)||!/пункта\s+3\s+статьи\s+1/iu.test(exception[1]))
    throw Error("Unexpected deferred subitems");
  const effectiveDate=addDays(pub.firstReportedPublication,61);
  return {
    actId:ACT,amendedLaw:"Z970000155_",article:"92-8",
    point:"пункт 3 статьи 1",subitem:37,
    firstOfficialPublication:pub.firstReportedPublication,
    generalRuleDays:60,effectiveDate,
    deferredSubitems:exceptions,deferredDate:"2027-01-01",
    officialLawUrl:BASE,publicationUrl:BASE+"/info",
    targetAmendmentUrl:BASE+"#z317",enactmentUrl:BASE+"#z341",
    changeExcerpt:change.slice(0,1100),
    metadataSourceVerified:true,
    transitionToEarlierActsVerified:false
  };
}
export async function getNotarial343Context({
  fetchImpl=fetch,asOf=new Date().toISOString().slice(0,10)
}={}){
  if(process.env.NOTARY_343_EFFECTIVE_CHECK_ENABLED==="0")return "";
  try{
    const [law,info]=await Promise.all([
      fetchOfficialLaw(BASE,fetchImpl),fetchOfficialLaw(BASE+"/info",fetchImpl)
    ]);
    const evidence=verifyNotarialAmendment343(law,info);
    const inForce=asOf>=evidence.effectiveDate;
    return "\nПРОВЕРКА ВСТУПЛЕНИЯ В СИЛУ ИМЕННО ПОПРАВКИ К СТАТЬЕ 92-8 (ЗАКОН № 343-VIII):"+
      "\nОфициальная первая публикация по метаданным Әділет: "+evidence.firstOfficialPublication+
      "; официальный URL: "+evidence.publicationUrl+
      ". Статья 2 изменяющего закона: 60 календарных дней после дня первой официальной публикации; "+
      "https://old.adilet.zan.kz/rus/docs/Z2600000343#z341."+
      "\nИзменение статьи 92-8 содержится в ПОДПУНКТЕ 37 ПУНКТА 3 СТАТЬИ 1, "+
      "https://old.adilet.zan.kz/rus/docs/Z2600000343#z317. "+
      "Исключения до 01.01.2027 относятся к подпунктам 4 и 34 пункта 3 статьи 1, "+
      "НЕ относятся к подпункту 37."+
      "\nДата вступления именно этой поправки в силу по официальным сведениям: "+
      evidence.effectiveDate+". На дату "+asOf+(inForce?" поправка УЖЕ ВСТУПИЛА В СИЛУ.":" поправка ЕЩЁ НЕ ВСТУПИЛА В СИЛУ.")+
      "\nСодержание изменения пункта 2 статьи 92-8: добавлены слова "+
      "«и (или) передана судебному исполнителю к принудительному исполнению»."+
      "\nВАЖНО: установленное начало действия новой процедуры не означает "+
      "обратного применения к законности нотариального действия, совершённого в 2024 году. "+
      "Для срока жалобы отдельно исследуй реальную осведомлённость, документы ЧСИ и "+
      "возможные специальные переходные нормы. Не называй дату вступления в силу неизвестной "+
      "после успешного получения этих двух официальных источников.";
  }catch{
    return "\nПРОВЕРКА ЗАКОНА № 343-VIII НЕ ЗАВЕРШЕНА: "+
      "полная официальная публикация, точная поправка к статье 92-8 и исключения "+
      "не были одновременно подтверждены. Не сообщай дату вступления как проверенную. "+
      "Источники: "+BASE+" и "+BASE+"/info.";
  }
}
