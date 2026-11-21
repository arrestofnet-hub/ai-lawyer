// Safe, deterministic legal source bibliography for downloaded consultations.
// These links identify official documents mentioned in the exported text;
// this is NOT proof that a given edition was operative on the facts' date.
const ACT_BASE="https://old.adilet.zan.kz/rus/docs/";
const GPK="K1500000377";
const NOTARY="Z970000155_";
const ENFORCEMENT="Z100000261_";
const NP="P220000006S";
const AMEND="Z2600000343";
const TRUSTED=/^https:\/\/(?:old\.)?adilet\.zan\.kz\/rus\/docs\/[A-Za-z0-9_]{6,32}(?:#[A-Za-z0-9_-]{1,40})?$/u;
export function officialExportReferences(markdown, modelSources=[]){
  const text=String(markdown||"");
  const refs=[];
  const seen=new Set();
  const add=(label,url)=>{
    if(!TRUSTED.test(url)||seen.has(url)||refs.length>=16)return;
    seen.add(url);refs.push({label,url});
  };
  // References appear ONLY when the actual model text names the source.
  // Do not add a normative reference simply because the user has an active case.
  const mentionsGpk=/(?<![\p{L}\p{N}])ГПК(?![\p{L}\p{N}])|гражданск\p{L}*\s+процессуал\p{L}*\s+кодекс/iu.test(text);
  if(mentionsGpk){
    const before=refs.length;
    for(const [number,fragment] of [["156","#z156"],["157",""],["158","#z158"],["364","#z364"]]){
      if(new RegExp("(?<!\\d)"+number+"(?!\\d)","u").test(text))
        add("ГПК РК, статья "+number,ACT_BASE+GPK+fragment);
    }
    if(refs.length===before)add("ГПК РК — общий официальный текст (статья не установлена)",ACT_BASE+GPK);
  }
  if(/нотариат|нотариальн\p{L}*|исполнительн\p{L}*\s+надпис/iu.test(text)){
    for(const n of ["92-6","92-8"]){
      if(text.includes(n))add("Закон РК «О нотариате», статья "+n,ACT_BASE+NOTARY);
    }
  }
  if(/(?:Закон[а-яё\s«»"']{0,35})?об\s+исполнительн\p{L}*\s+производств\p{L}*/iu.test(text))
    add("Закон РК «Об исполнительном производстве и статусе судебных исполнителей» — официальный текст",ACT_BASE+ENFORCEMENT);
  if(/(?:закон\p{L}*\s+(?:РК\s+)?[«"']?О\s+нотариате|Закон\s+«О\s+нотариате»)/iu.test(text)
     &&!refs.some(x=>x.url===ACT_BASE+NOTARY))
    add("Закон РК «О нотариате» — общий официальный текст (статья не установлена)",ACT_BASE+NOTARY);
  if(/343[\s-]*(?:VIII|VІII|8)|Z2600000343/iu.test(text))
    add("Закон РК № 343-VIII от 08.07.2026",ACT_BASE+AMEND);
  if(/(?:постановлен\p{L}*.*(?:Верховн\p{L}*\s+Суд\p{L}*|ВС)|(?:Верховн\p{L}*\s+Суд\p{L}*|ВС).*постановлен\p{L}*).{0,80}№\s*6/isu.test(text))
    add("Нормативное постановление ВС РК № 6 от 26.05.2022",ACT_BASE+NP+"#z24");
  for(const item of Array.isArray(modelSources)?modelSources:[]){
    const url=String(item?.url||"");
    if(!TRUSTED.test(url))continue;
    const title=String(item?.title||"Официальная публикация Әділет").replace(/\s+/g," ").slice(0,100);
    add(title,url);
  }
  return refs;
}
