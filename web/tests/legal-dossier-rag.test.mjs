import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {blankDossier,validateDossier,dossierView,dossierPromptContext,deriveCaseSignals}
  from "../legal/dossier.mjs";
import {validateLegalEntry,validateLegalCorpus,retrieveLegalPassages,
  buildLegalContext,legalCorpusStatus} from "../legal/norms.mjs";

test("dossier separates unsupported client claims from uploaded documents, and tracks dates/money",()=>{
  const message={id:crypto.randomUUID(),role:"user",createdAt:"2026-11-01T12:00:00Z",
    text:"Я оплатил 123 500 ₸ 15.10.2026, а уведомление получил 17.10.2026."};
  const assistant={id:crypto.randomUUID(),role:"assistant",createdAt:"2026-11-01T12:01:00Z",
    text:"Возможно, взыскано 500 000 ₸ 11.11.2026"};
  const doc={id:crypto.randomUUID(),filename:"contract.pdf",size:100,createdAt:"2026-11-02T12:00:00Z"};
  const raw=deriveCaseSignals([assistant,message]);
  assert.deepEqual(raw.dates.map(x=>x.date),["2026-10-15","2026-10-17"]);
  assert.equal(raw.amounts.length,1);
  assert.match(raw.amounts[0].amount,/123 500/);
  assert.equal(raw.amounts[0].sourceId,message.id);
  const view=dossierView({dossier:blankDossier()},[assistant,message],[doc]);
  assert.equal(view.dossier.revision,0);
  assert.equal(view.sources.length,2,"only documents and client messages can serve as references");
  assert.ok(view.warnings.every(x=>!x.includes("подтверждено судом")));
});

test("dossier edits are versioned, source scoped, non-free and never legal proof by default",()=>{
  const src=crypto.randomUUID(),doc=crypto.randomUUID();
  const messages=[{id:src,role:"user",text:"Суд ещё не вынес решение",createdAt:"2026-11-01T00:00:00Z"}];
  const docs=[{id:doc,filename:"example.pdf"}];
  const initial=blankDossier();
  const data={revision:0,nextStep:"Запросить расчёт",
    facts:[{statement:"Уведомление получено 2026-10-19",category:"notice",
      status:"supported",sourceIds:[doc],eventDate:"2026-10-19",note:"Уточнить вручение"}],
    tasks:[{title:"Проверить срок жалобы",state:"open",dueDate:"2026-11-28",note:"По НПА"}]};
  const result=validateDossier(data,initial,docs,messages);
  assert.equal(result.revision,1);
  assert.equal(result.facts[0].sourceIds[0],doc);
  assert.equal(result.tasks[0].dueDate,"2026-11-28");
  assert.match(dossierPromptContext(result),/аннотации пользователя/);
  assert.match(dossierPromptContext(result),/НЕ судебно установленные факты/);
  assert.equal(validateDossier({...data,revision:1,facts:result.facts,tasks:result.tasks},
    result,docs,messages).facts[0].id,result.facts[0].id);
  const error=(body,current=result)=>assert.throws(()=>
    validateDossier(body,current,docs,messages),e=>[400,409].includes(e.status));
  error({...data,revision:0},result);
  error({...data,revision:1,facts:[{...data.facts[0],sourceIds:[crypto.randomUUID()]}]});
  error({...data,revision:1,facts:[{...data.facts[0],sourceIds:[]}]});
  error({...data,revision:1,facts:[{...data.facts[0],eventDate:"2026-02-30"}]});
  error({...data,revision:1,facts:[{...data.facts[0],status:"judicially_proven"}]});
});

const LEGAL={
  id:"fictional-rk-act-1",actTitle:"Учебный нормативный акт Республики Казахстан",
  article:"Пункт 3",text:"Вымышленный фрагмент нормативного текста исключительно для теста системы поиска.",
  lang:"ru",sourceUrl:"https://adilet.zan.kz/rus/docs/TEST123",
  editionDate:"2026-10-01",checkedAt:"2026-10-20",
  effectiveFrom:"2026-10-01",effectiveTo:"2026-10-31",status:"historical"
};
test("local RAG accepts only dated official HTTPS sources, time filters and never invents laws",()=>{
  const valid=validateLegalEntry(LEGAL);
  assert.equal(validateLegalCorpus([LEGAL]).length,1);
  assert.deepEqual(retrieveLegalPassages([valid],"нормативного текста",{asOf:"2026-11-19"}),[]);
  assert.equal(retrieveLegalPassages([valid],"нормативного текста",{asOf:"2026-10-15"}).length,1);
  assert.match(buildLegalContext([valid],"нормативного текста",{asOf:"2026-10-15"}),/редакция 2026-10-01/);
  assert.equal(buildLegalContext([],"Любой запрос"),"");
  assert.deepEqual(legalCorpusStatus([]),{passages:0,officialSources:0,lastCheckedAt:null,ready:false});
  assert.throws(()=>validateLegalCorpus([LEGAL,LEGAL]),/Duplicate/);
  assert.throws(()=>validateLegalEntry({...LEGAL,sourceUrl:"https://attacker.invalid/rus/docs/123"}),/official/i);
  assert.throws(()=>validateLegalEntry({...LEGAL,sourceUrl:"http://adilet.zan.kz/docs/123"}),/HTTPS/i);
  assert.throws(()=>validateLegalEntry({...LEGAL,checkedAt:"2026-09-01"}),/predate/i);
  assert.throws(()=>validateLegalEntry({...LEGAL,effectiveTo:"2026-09-30"}),/precede/i);
});
