import {PACKAGES,PUBLIC_TOKEN_MULTIPLIER} from "./referrals.mjs";
export function currentPackages(db){
 return PACKAGES.map(p=>({...p,...(db.commercialSettings?.packages?.[p.id]||{})}));
}
export function freeBudget(db,fallback=15){
 const n=db.commercialSettings?.freeBudgetUsd;
 return Number.isFinite(n)&&n>=0&&n<=1000?n:(Number.isFinite(fallback)&&fallback>=0?Math.min(1000,fallback):15);
}
export function settingsVersion(db){return db.commercialSettings?.version||0;}
export function updateCommercialSettings(store,input,{paymentsEnabled=false,defaultBudget=15}={}){
 const previous=store.db.commercialSettings,oldAudit=store.db.commercialSettingsLog;
 if(input.version!==settingsVersion(store.db))throw Error("Stale settings");
 if(typeof input.reason!=="string"||input.reason.trim().length<3||input.reason.trim().length>160)throw Error("Invalid reason");
 const next={...previous,version:settingsVersion(store.db)+1,packages:{...previous?.packages}};
 let before,after;
 if(input.kind==="budget"){
  if(!Number.isFinite(input.usd)||input.usd<0||input.usd>1000||Math.abs(input.usd*100-Math.round(input.usd*100))>1e-6)throw Error("Invalid budget");
  before=freeBudget(store.db,defaultBudget);after=input.usd;next.freeBudgetUsd=after;
 }else if(input.kind==="package"){
  if(paymentsEnabled)throw Error("Stop checkout before editing packages");
  before=currentPackages(store.db).find(p=>p.id===input.id);
  if(!before||!Number.isSafeInteger(input.tokens)||input.tokens<100||input.tokens>10000000||input.tokens%PUBLIC_TOKEN_MULTIPLIER!==0||!Number.isSafeInteger(input.priceKzt)||input.priceKzt<1||input.priceKzt>1000000)throw Error("Invalid package");
  after={...before,tokens:input.tokens,priceKzt:input.priceKzt};
  next.packages[input.id]={tokens:after.tokens,priceKzt:after.priceKzt};
 }else throw Error("Invalid settings kind");
 store.db.commercialSettings=next;
 store.db.commercialSettingsLog=[...(oldAudit||[]),{kind:input.kind,before,after,reason:input.reason.trim(),at:new Date().toISOString(),version:next.version,actor:"admin"}];
 try{store.save();}catch(e){
  if(previous===undefined)delete store.db.commercialSettings;else store.db.commercialSettings=previous;
  if(oldAudit===undefined)delete store.db.commercialSettingsLog;else store.db.commercialSettingsLog=oldAudit;
  throw e;
 }
 return next.version;
}
