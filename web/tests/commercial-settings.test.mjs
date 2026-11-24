import test from "node:test";
import assert from "node:assert/strict";
import {currentPackages,freeBudget,updateCommercialSettings} from "../commercial-settings.mjs";
import {createOrder,settleVerifiedPayment} from "../payments.mjs";
import {renderAdmin} from "../admin-dashboard.mjs";
const fixture=()=>({db:{users:[{id:"u",credits:200,accountType:"trial"}]},save(){}});
const pkg={kind:"package",id:"try",priceKzt:1200,tokens:15000,version:0,reason:"New tariff"};
test("package edits are audited and preserve existing order snapshots",()=>{
 const s=fixture(),req={userId:"u",packageId:"try",provider:"bcc",requestId:"one",expectedPriceKzt:990,expectedTokens:10000};
 const old=createOrder(s,req);
 assert.equal(updateCommercialSettings(s,pkg),1);
 assert.equal(currentPackages(s.db)[0].priceKzt,1200);
 assert.equal(s.db.commercialSettingsLog.length,1);
 assert.equal(createOrder(s,req).id,old.id);
 assert.throws(()=>createOrder(s,{...req,requestId:"two"}));
 assert.equal(createOrder(s,{...req,requestId:"two",expectedPriceKzt:1200,expectedTokens:15000}).tokens,15000);
 settleVerifiedPayment(s,{orderId:old.id,provider:"bcc",transactionId:"tx1",amountMinor:99000,currency:"KZT",status:"captured"});
 assert.equal(s.db.users[0].credits,300);
 assert.throws(()=>updateCommercialSettings(s,pkg));
});
test("live checkout and invalid packages reject edits",()=>{
 const s=fixture();
 assert.throws(()=>updateCommercialSettings(s,pkg,{paymentsEnabled:true}));
 for(const values of [{tokens:1},{priceKzt:0},{id:"fake"},{tokens:Infinity}])assert.throws(()=>updateCommercialSettings(s,{...pkg,...values}));
 assert.equal(s.db.commercialSettings,undefined);
});
test("budget pause and failed save rollback",()=>{
 const s=fixture();
 assert.equal(freeBudget(s.db,20),20);
 updateCommercialSettings(s,{kind:"budget",usd:0,version:0,reason:"Pause free"});
 assert.equal(freeBudget(s.db),0);
 s.save=()=>{throw Error("disk");};
 assert.throws(()=>updateCommercialSettings(s,{...pkg,version:1}));
 assert.equal(currentPackages(s.db)[0].priceKzt,990);
 assert.equal(s.db.commercialSettingsLog.length,1);
 assert.ok(renderAdmin(s.db,{csrf:"abc"}).includes("Настройки бесплатного API-бюджета"));
});
