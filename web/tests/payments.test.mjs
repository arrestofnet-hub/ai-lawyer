import test from "node:test";
import assert from "node:assert/strict";
import {createOrder,listOrders,settleVerifiedPayment} from "../payments.mjs";
function fixture(){
  return {db:{users:[{id:"u1",credits:200,accountType:"trial"},{id:"u2",credits:0,accountType:"trial"}]},save(){}};
}
const make=(s,extra={})=>createOrder(s,{userId:"u1",packageId:"try",provider:"bcc",requestId:"r1",...extra});
const proof=(o,extra={})=>({orderId:o.id,provider:"bcc",transactionId:"t1",amountMinor:99000,currency:"KZT",status:"captured",...extra});
test("orders use server-side prices, are idempotent and private",()=>{
  const s=fixture(),o=make(s,{priceKzt:1,tokens:999999});
  assert.equal(o.priceKzt,990);assert.equal(o.tokens,10000);assert.equal(o.status,"pending");
  assert.equal(make(s).id,o.id);assert.equal(s.db.users[0].credits,200);
  assert.equal(listOrders(s,"u2").length,0);assert.equal(listOrders(s,"u1").length,1);
  assert.equal(Object.hasOwn(listOrders(s,"u1")[0],"userId"),false);
  assert.throws(()=>make(s,{packageId:"pro"}));assert.throws(()=>make(s,{requestId:"r2",packageId:"fake"}));
  assert.throws(()=>make(s,{requestId:"r2",provider:"fake"}));
});
test("verified captured payment adds the correct internal credits once",()=>{
  const s=fixture(),o=make(s);
  assert.equal(settleVerifiedPayment(s,proof(o)).credited,true);
  assert.equal(s.db.users[0].credits,300);assert.equal(s.db.users[0].accountType,"paid");
  assert.equal(settleVerifiedPayment(s,proof(o)).credited,false);
  assert.equal(s.db.users[0].credits,300);assert.equal(listOrders(s,"u1")[0].status,"paid");
  assert.throws(()=>settleVerifiedPayment(s,proof(o,{transactionId:"t2"})));
  const second=make(s,{requestId:"r2",userId:"u2"});
  assert.throws(()=>settleVerifiedPayment(s,proof(second)));
  assert.equal(s.db.users[1].credits,0);
});
test("wrong amount, currency, provider, order, status and invalid transaction are rejected",()=>{
  const s=fixture(),o=make(s);
  for(const fields of [{amountMinor:1},{currency:"USD"},{provider:"halyk"},{orderId:"bad"},{status:"authorized"},{status:"failed"},{transactionId:""}])
    assert.throws(()=>settleVerifiedPayment(s,proof(o,fields)));
  assert.equal(s.db.users[0].credits,200);assert.equal(listOrders(s,"u1")[0].status,"pending");
});
test("save failure rolls back both order creation and balance settlement",()=>{
  const s=fixture();s.save=()=>{throw Error("disk")};
  assert.throws(()=>make(s));assert.equal(listOrders(s,"u1").length,0);
  s.save=()=>{};const o=make(s);s.save=()=>{throw Error("disk")};
  assert.throws(()=>settleVerifiedPayment(s,proof(o)));
  assert.equal(s.db.users[0].credits,200);assert.equal(s.db.users[0].accountType,"trial");
  assert.equal(listOrders(s,"u1")[0].status,"pending");
  s.save=()=>{};assert.equal(settleVerifiedPayment(s,proof(o)).credited,true);
});
