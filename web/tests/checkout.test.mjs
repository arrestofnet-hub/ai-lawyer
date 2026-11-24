import test from "node:test";
import assert from "node:assert/strict";
import {startCheckout,reconcileCheckout} from "../checkout.mjs";
const fixture=()=>({db:{users:[{id:"u",accountType:"trial",credits:200}]},save(){}});
const req={userId:"u",packageId:"try",provider:"bcc",requestId:"req1"};
function fake(){
  let captured=false,invalid=false;
  return {checkoutOrigins:["https://bank.example"],
    async initiate({orderId}){return {orderId,checkoutUrl:invalid?"https://fake.example/":"https://bank.example/pay/"+orderId};},
    async fetchPayment({orderId}){return {orderId,provider:"bcc",transactionId:"t1",currency:"KZT",amountMinor:99000,status:captured?"captured":"pending"};},
    capture(){captured=true;},invalid(){invalid=true;}};
}
test("checkout cannot start without configured provider",async()=>{
  const s=fixture();
  await assert.rejects(startCheckout(s,{},req));
  assert.equal(s.db.paymentOrders,undefined);
});
test("checkout and authoritative reconciliation credit once only",async()=>{
  const s=fixture(),a=fake(),adapters={bcc:a};
  const first=await startCheckout(s,adapters,req);
  const second=await startCheckout(s,adapters,req);
  assert.equal(first.order.id,second.order.id);
  assert.equal(new URL(first.checkoutUrl).origin,"https://bank.example");
  assert.equal((await reconcileCheckout(s,adapters,{provider:"bcc",orderId:first.order.id})).credited,false);
  assert.equal(s.db.users[0].credits,200);
  a.capture();
  assert.equal((await reconcileCheckout(s,adapters,{provider:"bcc",orderId:first.order.id})).credited,true);
  assert.equal((await reconcileCheckout(s,adapters,{provider:"bcc",orderId:first.order.id})).credited,false);
  assert.equal(s.db.users[0].credits,300);
});
test("untrusted redirects and mismatched provider evidence fail closed",async()=>{
  const s=fixture(),a=fake(),adapters={bcc:a};
  a.invalid();
  await assert.rejects(startCheckout(s,adapters,req));
  const order=s.db.paymentOrders[0];
  a.fetchPayment=async()=>({orderId:order.id,provider:"bcc",currency:"KZT",amountMinor:1,status:"captured",transactionId:"t1"});
  await assert.rejects(reconcileCheckout(s,adapters,{provider:"bcc",orderId:order.id}));
  assert.equal(s.db.users[0].credits,200);
});
