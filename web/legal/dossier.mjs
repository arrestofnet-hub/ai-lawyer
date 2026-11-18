// Evidence-aware, deterministic case memory. Stored inside the existing encrypted
// case database, never in a public corpus. Do not treat assistant text or an
// uploaded file's name as proof that its contents have been verified.
import crypto from "node:crypto";

const STATUSES=new Set(["claimed","supported","disputed","unknown"]);
const CATEGORIES=new Set(["fact","contract","payment","notice","procedure","deadline","other"]);
const TASK_STATES=new Set(["open","done","paused"]);
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const UUID=/^[a-f0-9-]{36}$/i;
const MAX_FACTS=80,MAX_TASKS=30;
const short=(value,max)=>String(value??"").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").trim().slice(0,max);
function invalid(message){const e=new Error(message);e.status=400;throw e;}
function dateOrNull(value){
  if(value==null||value==="")return null;
  if(typeof value!=="string"||!ISO_DATE.test(value))invalid("Дата должна иметь формат ГГГГ-ММ-ДД");
  const d=new Date(value+"T00:00:00.000Z");
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)
    invalid("Некорректная календарная дата");
  return value;
}
export function blankDossier(){
  return {revision:0,facts:[],tasks:[],nextStep:"",updatedAt:null};
}
export function validateDossier(input,current,documents,messages){
  if(!input||typeof input!=="object"||Array.isArray(input))invalid("Передайте карточку дела");
  const former=current||blankDossier();
  if(!Number.isInteger(input.revision)||input.revision!==former.revision){
    const e=new Error("Карточка дела изменилась в другой вкладке. Обновите её перед сохранением.");
    e.status=409;throw e;
  }
  if(!Array.isArray(input.facts)||input.facts.length>MAX_FACTS)
    invalid("Допускается не более 80 обстоятельств");
  if(!Array.isArray(input.tasks)||input.tasks.length>MAX_TASKS)
    invalid("Допускается не более 30 действий");
  if(typeof input.nextStep!=="string"||input.nextStep.length>1500)
    invalid("Следующий шаг слишком длинный");
  const sourceIds=new Set([...documents.map(d=>d.id),
    ...messages.filter(m=>m.role==="user").map(m=>m.id)]);
  const formerFacts=new Set((former.facts||[]).map(f=>f.id));
  const seen=new Set();
  const facts=input.facts.map(f=>{
    if(!f||typeof f!=="object")invalid("Неверный формат обстоятельства");
    const statement=short(f.statement,1500);
    if(!statement||statement.length<4)invalid("Заполните обстоятельство");
    if(!STATUSES.has(f.status))invalid("Неизвестный статус доказательства");
    if(!CATEGORIES.has(f.category))invalid("Неизвестная категория обстоятельства");
    if(!Array.isArray(f.sourceIds)||f.sourceIds.length>10)
      invalid("Укажите до десяти источников");
    const ids=[...new Set(f.sourceIds)];
    if(ids.some(id=>typeof id!=="string"||!sourceIds.has(id)))
      invalid("Источник должен принадлежать выбранному делу и быть сообщением клиента или документом");
    if(f.status==="supported"&&!ids.length)
      invalid("Для статуса «подтверждается источником» необходимо указать источник");
    const id=typeof f.id==="string"&&formerFacts.has(f.id)&&UUID.test(f.id)
      ? f.id:crypto.randomUUID();
    if(seen.has(id))invalid("Обстоятельство повторяется");
    seen.add(id);
    return {id,statement,status:f.status,category:f.category,sourceIds:ids,
      eventDate:dateOrNull(f.eventDate),note:short(f.note,800)};
  });
  const formerTasks=new Set((former.tasks||[]).map(t=>t.id));
  const seenTasks=new Set();
  const tasks=input.tasks.map(t=>{
    if(!t||typeof t!=="object")invalid("Неверный формат действия");
    const title=short(t.title,320);
    if(!title)invalid("Название действия не может быть пустым");
    if(!TASK_STATES.has(t.state))invalid("Неизвестный статус действия");
    const id=typeof t.id==="string"&&formerTasks.has(t.id)&&UUID.test(t.id)
      ? t.id:crypto.randomUUID();
    if(seenTasks.has(id))invalid("Действие повторяется");
    seenTasks.add(id);
    return {id,title,state:t.state,dueDate:dateOrNull(t.dueDate),
      note:short(t.note,800)};
  });
  return {revision:former.revision+1,facts,tasks,
    nextStep:short(input.nextStep,1500),updatedAt:new Date().toISOString()};
}

const DATE_RX=/\b(?:\d{2}[.]\d{2}[.]\d{4}|\d{4}-\d{2}-\d{2})\b/g;
const MONEY_RX=/(?<!\d)\d[\d \u00a0]{0,15}(?:[.,]\d{1,2})?\s*(?:₸|тенге|тг\b|KZT\b)/giu;
function localDate(raw){
  if(/^\d{4}-/.test(raw))return dateOrNull(raw);
  const [dd,mm,yyyy]=raw.split(".");
  try{return dateOrNull(yyyy+"-"+mm+"-"+dd);}catch{return null;}
}
function excerpt(raw,index,length){
  const start=Math.max(0,index-76),end=Math.min(raw.length,index+length+90);
  return short((start?"…":"")+raw.slice(start,end)+(end<raw.length?"…":""),260);
}
export function deriveCaseSignals(messages,limit=70){
  const dates=[],amounts=[];
  for(const m of messages){
    if(m.role!=="user"||typeof m.text!=="string")continue;
    const body=m.text.slice(0,20000);
    for(const match of body.matchAll(DATE_RX)){
      const date=localDate(match[0]);
      if(date&&dates.length<limit)dates.push({
        date,quote:excerpt(body,match.index,match[0].length),
        sourceId:m.id,sourceType:"user_message",
        verification:"Со слов клиента, требует первичного подтверждения"
      });
    }
    for(const match of body.matchAll(MONEY_RX)){
      if(amounts.length<limit)amounts.push({
        amount:short(match[0],48),quote:excerpt(body,match.index,match[0].length),
        sourceId:m.id,sourceType:"user_message",
        verification:"Заявленная сумма, бухгалтерская сверка не проведена"
      });
    }
  }
  dates.sort((a,b)=>a.date.localeCompare(b.date));
  return {dates,amounts};
}
export function dossierView(caseData,messages,documents){
  const record=caseData.dossier||blankDossier();
  const signals=deriveCaseSignals(messages);
  const sources=[
    ...documents.map(d=>({id:d.id,type:"document",title:d.filename,
      verification:"Загружен файл; содержание и подлинность не проверены"})),
    ...messages.filter(m=>m.role==="user").map(m=>({
      id:m.id,type:"client_message",title:"Сообщение клиента от "+m.createdAt,
      verification:"Утверждение клиента, не доказательство само по себе"
    }))
  ];
  return {
    dossier:{...record,facts:[...(record.facts||[])],tasks:[...(record.tasks||[])]},
    chronology:signals.dates,amounts:signals.amounts,sources,
    warnings:[
      "Автоматические даты и суммы получены только из сообщений клиента; это не установленные юридические факты.",
      "Статус «подтверждается источником» устанавливает пользователь, но не подтверждает подлинность или достаточность доказательства.",
      "Правовые и процессуальные сроки проверяются по применимой редакции закона отдельно."
    ]
  };
}
export function dossierPromptContext(record){
  const d=record||blankDossier();
  if(!(d.facts?.length||d.tasks?.length||d.nextStep))return "";
  const facts=(d.facts||[]).slice(0,50).map(f=>
    "- ["+f.status+"; "+f.category+"; "+
    (f.eventDate||"без даты")+"] "+f.statement+
    (f.sourceIds?.length?" (источники: "+f.sourceIds.join(", ")+")":" (без приложенных источников)")+
    (f.note?"; замечание: "+f.note:""));
  const tasks=(d.tasks||[]).slice(0,20).map(t=>
    "- ["+t.state+"; "+(t.dueDate||"без срока")+"] "+t.title);
  return (
    "\nДОСЬЕ ДЕЛА (аннотации пользователя, НЕ судебно установленные факты):\n"+
    facts.join("\n")+
    (tasks.length?"\nОТКРЫТЫЕ И ЗАКРЫТЫЕ ДЕЙСТВИЯ:\n"+tasks.join("\n"):"")+
    (d.nextStep?"\nНАМЕЧЕННЫЙ СЛЕДУЮЩИЙ ШАГ: "+d.nextStep:"")+
    "\nПравило: статус supported = отмечено пользователем как основанное на документе; проверь текст и достаточность источника самостоятельно."
  ).slice(0,9500);
}
