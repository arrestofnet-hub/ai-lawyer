// Select only relevant PUBLIC general Kazakhstan-law playbooks. The full core
// methodology remains unchanged and appears before these domain instructions.
// Do not include private case files, personal chat history or raw client data.
const RULES=Object.freeze([
  ["Исполнительное производство / ЧСИ",/(?:чси|исполнител|аис.?оип|арест.{0,18}сч[её]т|запрет.{0,15}выезд|реестр.{0,15}должник)/iu],
  ["Исполнительная надпись нотариуса",/(?:исполнител[ьн\w]{0,5}\s+надпис|нотариальн.{0,20}надпис|нотариус|нотариальн)/iu],
  ["Судебный приказ",/(?:судебн.{0,10}приказ|приказн.{0,10}производств)/iu],
  ["Упрощённое и исковое производство",/(?:апелляц|упрощ[её]нн|восстановлен.{0,16}срок|судебн.{0,16}решени|исков.{0,12}производств)/iu],
  ["Цессия / коллекторы",/(?:цесс|коллектор|уступк|переход.{0,12}прав.{0,15}требован)/iu],
  ["Кредиты и МФО",/(?:мфо|микрокредит|за[её]м|займ|кредит|реструктуризац|банк|страхов)/iu],
  ["Автозалог и реализация имущества",/(?:автозалог|залог.{0,20}(?:авто|машин|имущ)|изъят.{0,15}(?:авто|машин)|продаж.{0,20}(?:авто|залог)|автомобил|автокредит|смс.?код|sms.?код)/iu],
  ["КоАП / административные штрафы",/(?:коап|административн.{0,12}штраф|постановлен.{0,16}штраф)/iu],
  ["Жалобы в государственные органы / АППК",/(?:аппк|еотiнiш|eotinish|госорган|государственн.{0,15}орган|департамент|регулятор|аррфр|минюст|акимат|прокуратур)/iu],
  ["Уголовно-правовой маршрут",/(?:уголовн|полици|следоват|куи|мошенничест|ук.{0,4}рк)/iu],
  ["Коммунальные платежи и МЖД",/(?:коммунал|кск|ос[иэ]и|мжд|квитанц|тариф.{0,15}(?:дом|квартир|мжд)|капремонт|модернизац|содержани.{0,10}дом)/iu]
]);
const COMMON=new Set(["Универсальные требования к живому ответу","Документы и стиль"]);
function sectionsOf(source){
  const matches=[...source.matchAll(/^## (.+)\r?$/gm)];
  return {header:source.slice(0,matches[0]?.index??source.length),
    sections:matches.map((hit,i)=>({title:hit[1].trim(),
      body:source.slice(hit.index,i+1<matches.length?matches[i+1].index:source.length)}))};
}
export function selectLegalPlaybooks(source,question,summary=""){
  if(typeof source!=="string")return "";
  const {header,sections}=sectionsOf(source);
  if(!sections.length)return source;
  const text=(String(question||"")+" "+String(summary||"")).slice(0,10000);
  const matched=new Set(RULES.filter(([_,rx])=>rx.test(text)).map(([title])=>title));
  // Unknown area: preserve all playbooks instead of leaving the model without
  // domain context. Never falsely assume all legal requests match a single rule.
  if(!matched.size)return source;
  return header+sections.filter(s=>COMMON.has(s.title)||matched.has(s.title))
    .map(s=>s.body).join("");
}
export const PLAYBOOK_DOMAINS=RULES.map(([title])=>title);
