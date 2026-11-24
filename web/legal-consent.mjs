import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");
const labels={offer:"OFFER_DRAFT.md",privacy:"PRIVACY_DRAFT.md",consent:"CONSENT_DRAFT.md"};
export function validateSeller(c){
  if(!c||typeof c!=="object"||!/^\d{12}$/.test(c.seller_iin||""))throw Error("Invalid seller identifier");
  for(const k of ["seller_name","seller_address","seller_phone","support_email","server_location"]){
    if(typeof c[k]!=="string"||!c[k].trim()||c[k].length>240||/[\u0000-\u001f\u007f{}]/.test(c[k]))throw Error("Invalid legal configuration");
  }
  return c;
}
export function normalizeName(value){
  if(typeof value!=="string")throw Error("Full name required");
  const name=value.normalize("NFC").trim().replace(/ +/g," ");
  if(name.length<3||name.length>160||!/^\p{L}[\p{L}\p{M} .’'\-]*$/u.test(name)||name.split(" ").length<2)throw Error("Full name required");
  return name;
}
export function loadDrafts(c){
  validateSeller(c);
  const replacements={SELLER_NAME:c.seller_name,SELLER_ADDRESS:c.seller_address,SELLER_PHONE:c.seller_phone,SUPPORT_EMAIL:c.support_email,SELLER_IDENTIFIER:c.seller_iin};
  const documents=Object.fromEntries(Object.entries(labels).map(([key,file])=>{
    let body=readFileSync(new URL("./strategy/legal-launch/"+file,import.meta.url),"utf8");
    // Private preview excludes developer notes; draft notice remains visible.
    body=body.split("\n## Implementation gates (not public)")[0];
    body=body.replace(/\{\{([A-Z_]+)\}\}/g,(all,key)=>key==="SUBJECT_FULL_NAME"?all:replacements[key]??all);
    if(/\{\{(?!SUBJECT_FULL_NAME\}\})[A-Z_]+\}\}/.test(body))throw Error("Unfilled legal field");
    return [key,body];
  }));
  return Object.freeze({status:"draft",documents:Object.freeze(documents),version:hash(JSON.stringify(documents))});
}
export function consentDocuments(bundle,fullName){
  const name=normalizeName(fullName);
  const consent=bundle.documents.consent.replaceAll("{{SUBJECT_FULL_NAME}}",name);
  return {...bundle.documents,consent};
}
// Foundation only. Approved policy bundle must be separately verified and wired
// to every entry point before accepting real users. Drafts can never be accepted.
export function saveConsent(store,bundle,subject,input,at=new Date()){
  if(bundle?.status!=="approved")throw Error("Legal documents not approved");
  if(!subject||!["account","guest"].includes(subject.kind)||typeof subject.id!=="string"||!subject.id||subject.id.length>200)throw Error("Invalid subject");
  if(input?.version!==bundle.version||input.acceptTerms!==true||input.acceptData!==true||input.acceptTransfer!==true)throw Error("Explicit current consent required");
  const name=normalizeName(input.fullName);
  const docs=consentDocuments(bundle,name);
  const expected=hash(JSON.stringify(bundle.documents));
  if(bundle.version!==expected)throw Error("Invalid version");
  const prior=store.db.legalConsents;
  const existing=(prior||[]).find(x=>x.kind===subject.kind&&x.subjectId===subject.id&&x.version===bundle.version&&x.fullName===name&&!x.revokedAt);
  if(existing)return existing.id;
  const snapshots=store.db.legalDocumentVersions;
  const receipt={id:randomUUID(),kind:subject.kind,subjectId:subject.id,fullName:name,version:bundle.version,consentHash:hash(docs.consent),acceptedAt:at.toISOString(),terms:true,data:true,transfer:true};
  store.db.legalDocumentVersions={...snapshots,[bundle.version]:bundle.documents};
  store.db.legalConsents=[...(prior||[]),receipt];
  try{store.save();}catch(e){
    if(prior===undefined)delete store.db.legalConsents;else store.db.legalConsents=prior;
    if(snapshots===undefined)delete store.db.legalDocumentVersions;else store.db.legalDocumentVersions=snapshots;
    throw e;
  }
  return receipt.id;
}
