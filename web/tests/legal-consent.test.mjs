import test from "node:test";
import assert from "node:assert/strict";
import {validateSeller,normalizeName,loadDrafts,consentDocuments,saveConsent} from "../legal-consent.mjs";
const cfg={seller_name:"ИП Тест",seller_iin:"000000000000",seller_address:"Алматы, тест",seller_phone:"+70000000000",support_email:"support@example.test",server_location:"Алматы"};
const subject={kind:"account",id:"test-account"};
const fixture=()=>({db:{},save(){}});
test("all three bilingual drafts render without private configuration in Git",()=>{
 const b=loadDrafts(cfg);
 assert.equal(b.status,"draft");
 for(const d of Object.values(b.documents)){assert.ok(d.includes("ИП Тест"));assert.ok(d.includes("## Қазақша"));}
 assert.ok(!b.documents.consent.includes("Implementation gates"));
 assert.ok(consentDocuments(b,"Тест Тестов").consent.includes("Тест Тестов"));
});
test("invalid seller settings rejected",()=>{
 for(const x of [{seller_iin:"123"},{seller_address:""},{seller_name:"<a>\n"}])assert.throws(()=>validateSeller({...cfg,...x}));
});
test("name validation preserves Kazakh letters and rejects controls",()=>{
 assert.equal(normalizeName("  Әли   Омарұлы "), "Әли Омарұлы");
 for(const x of ["", "A", "Иван 123", "Иван\nИванов", "<script> Test"])assert.throws(()=>normalizeName(x));
});
test("drafts cannot be accepted",()=>{
 const s=fixture(),b=loadDrafts(cfg);
 assert.throws(()=>saveConsent(s,b,subject,{version:b.version,fullName:"Тест Тестов",acceptTerms:true,acceptData:true,acceptTransfer:true}));
 assert.deepEqual(s.db,{});
});
test("explicit three consents and current version required",()=>{
 const s=fixture(),b={...loadDrafts(cfg),status:"approved"};
 const i={version:b.version,fullName:"Тест Тестов",acceptTerms:true,acceptData:true,acceptTransfer:true};
 for(const x of [{acceptTerms:false},{acceptData:false},{acceptTransfer:false},{version:"old"},{acceptData:"true"}])assert.throws(()=>saveConsent(s,b,subject,{...i,...x}));
 assert.deepEqual(s.db,{});
});
test("receipt and original versions stored once, with no extra client fields",()=>{
 const s=fixture(),b={...loadDrafts(cfg),status:"approved"};
 const i={version:b.version,fullName:"Тест Тестов",acceptTerms:true,acceptData:true,acceptTransfer:true,extra:"ignored"};
 const id=saveConsent(s,b,subject,i,new Date("2026-11-24T12:00:00Z"));
 assert.equal(saveConsent(s,b,subject,i),id);
 assert.equal(s.db.legalConsents.length,1);
 assert.equal(s.db.legalConsents[0].extra,undefined);
 assert.equal(s.db.legalConsents[0].acceptedAt,"2026-11-24T12:00:00.000Z");
 assert.deepEqual(s.db.legalDocumentVersions[b.version],b.documents);
});
test("save failure rolls back consent and versions",()=>{
 const s={db:{},save(){throw Error("disk");}},b={...loadDrafts(cfg),status:"approved"};
 assert.throws(()=>saveConsent(s,b,subject,{version:b.version,fullName:"Тест Тестов",acceptTerms:true,acceptData:true,acceptTransfer:true}));
 assert.deepEqual(s.db,{});
});
