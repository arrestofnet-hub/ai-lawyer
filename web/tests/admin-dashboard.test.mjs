import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {adminSummary,renderAdmin,createAdminDashboard,adminAuthorizedRequest,grantBonus,changeAccountAccess} from "../admin-dashboard.mjs";
const key="a".repeat(64),auth="Basic "+Buffer.from("admin:"+key).toString("base64");
const db={users:[{id:"u",email:"<script>alert(1)</script>",credits:200,accountType:"trial",pass:"SECRET_HASH"},{id:"v",email:"person@example.kz",credits:100,accountType:"paid"}],
  paymentOrders:[{id:"1",amountMinor:99000,status:"paid",provider:"bcc",transactionId:"PRIVATE_TX"},{id:"2",amountMinor:199000,status:"pending",provider:"bcc"}],
  providerUsage:[{at:"2026-11-24T12:00:00Z",estimatedUsd:0.25,free:true,userId:"u"}],
  sessions:[{hash:"SECRET_SESSION"}],messages:[{text:"SECRET_CASE"}]};
test("dashboard separates pending payments and measured API costs",()=>{
  const s=adminSummary(db,Date.parse("2026-11-24T13:00:00Z"));
  assert.equal(s.grossKzt,990);assert.equal(s.pendingOrders,1);assert.equal(s.paidOrders,1);
  assert.equal(s.cost24h,0.25);assert.equal(s.trial,1);assert.equal(s.paidAccounts,1);
});
test("dashboard escapes user data and omits secrets and case contents",()=>{
  const html=renderAdmin(db);
  assert.ok(html.includes("&lt;script&gt;"));assert.ok(!html.includes("<script>"));
  for(const secret of ["SECRET_HASH","SECRET_SESSION","SECRET_CASE","PRIVATE_TX"])assert.ok(!html.includes(secret));
  assert.ok(renderAdmin(db,{query:"person"}).includes("person@example.kz"));
  assert.ok(!renderAdmin(db,{query:"person"}).includes("alert(1)"));
});
test("admin requires separate credential and rejects proxies and remote hosts",()=>{
  const req={headers:{host:"127.0.0.1:8792",authorization:auth},socket:{remoteAddress:"127.0.0.1"}};
  assert.equal(adminAuthorizedRequest(req,key),true);
  for(const headers of [{authorization:""},{host:"evil.example"},{ "x-real-ip":"127.0.0.1"},{ "sec-fetch-site":"cross-site"}])
    assert.equal(adminAuthorizedRequest({...req,headers:{...req.headers,...headers}},key),false);
  assert.equal(adminAuthorizedRequest({...req,socket:{remoteAddress:"8.8.8.8"}},key),false);
  assert.throws(()=>createAdminDashboard({db},{secret:"weak"}));
});
test("dashboard HTTP endpoints require authentication and reject unsupported writes",async()=>{
  const server=createAdminDashboard({db},{secret:key});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const base="http://127.0.0.1:"+server.address().port;
  try{
    assert.equal((await fetch(base)).status,401);
    const options={headers:{authorization:auth}};
    const response=await fetch(base,options);
    assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
    assert.ok((await response.text()).includes("История")===false);
    assert.equal((await fetch(base,{...options,method:"POST"})).status,405);
    assert.equal((await fetch(base+"/anything",options)).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("bonus grants are idempotent, audited and do not mark accounts paid",()=>{
  const s={db:{users:[{id:"u",credits:200,accountType:"trial"}]},save(){}};
  const input={userId:"u",tokens:5000,reason:"Бонус",requestId:"00000000-0000-4000-8000-000000000001"};
  assert.equal(grantBonus(s,input).balance,25000);
  assert.equal(grantBonus(s,input).granted,false);
  assert.equal(s.db.adminBonusGrants.length,1);
  assert.equal(s.db.users[0].accountType,"trial");
  assert.equal(s.db.paymentOrders,undefined);
  assert.throws(()=>grantBonus(s,{...input,tokens:100}));
  for(const tokens of [-100,1,200100,NaN])assert.throws(()=>grantBonus(s,{...input,tokens}));
  s.save=()=>{throw Error("disk failure");};
  assert.throws(()=>grantBonus(s,{...input,requestId:"00000000-0000-4000-8000-000000000002"}));
  assert.equal(s.db.users[0].credits,250);
  assert.equal(s.db.adminBonusGrants.length,1);
});
test("bonus endpoint requires origin, CSRF and authentication",async()=>{
  const s={db:{users:[{id:"u",credits:200,accountType:"trial",email:"test@example.kz"}]},save(){}};
  const server=createAdminDashboard(s,{secret:key});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const base="http://127.0.0.1:"+server.address().port;
  try{
    const html=await (await fetch(base,{headers:{authorization:auth}})).text();
    const csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)[1];
    const body=new URLSearchParams({csrf,userId:"u",tokens:"5000",reason:"test grant",requestId:"00000000-0000-4000-8000-000000000001"});
    const post=(headers,b=body)=>fetch(base+"/bonus",{method:"POST",headers,body:b,redirect:"manual"});
    assert.equal((await post({origin:base})).status,401);
    assert.equal((await post({authorization:auth,origin:"https://evil.example"})).status,403);
    assert.equal((await post({authorization:auth,origin:base},new URLSearchParams({...Object.fromEntries(body),csrf:"0".repeat(64)}))).status,403);
    assert.equal((await post({authorization:auth,origin:base})).status,303);
    assert.equal((await post({authorization:auth,origin:base})).status,303);
    assert.equal(s.db.users[0].credits,250);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("blocking revokes sessions, preserves balance and is reversible with audit",()=>{
  const u={id:"u",accountType:"paid",credits:123};
  const s={db:{users:[u],sessions:[{userId:"u"},{userId:"other"}]},save(){}};
  const input={userId:"u",action:"block",reason:"Review",requestId:"00000000-0000-4000-8000-000000000001"};
  assert.throws(()=>changeAccountAccess(s,input,()=>true));
  assert.equal(changeAccountAccess(s,input).changed,true);
  assert.ok(u.blockedAt);assert.equal(u.credits,123);assert.equal(u.accountType,"paid");
  assert.deepEqual(s.db.sessions,[{userId:"other"}]);
  assert.equal(changeAccountAccess(s,input).changed,false);
  const undo={...input,action:"unblock",requestId:"00000000-0000-4000-8000-000000000002"};
  s.save=()=>{throw Error("disk");};
  assert.throws(()=>changeAccountAccess(s,undo));assert.ok(u.blockedAt);
  s.save=()=>{};
  assert.equal(changeAccountAccess(s,undo).changed,true);
  assert.equal(u.blockedAt,undefined);assert.equal(s.db.adminAccessLog.length,2);
});
test("account access endpoint requires CSRF and correct origin",async()=>{
  const s={db:{users:[{id:"u",credits:200,accountType:"trial",email:"test@example.kz"}],sessions:[{userId:"u"}]},save(){}};
  const server=createAdminDashboard(s,{secret:key});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const base="http://127.0.0.1:"+server.address().port;
  try{
    const html=await (await fetch(base,{headers:{authorization:auth}})).text();
    const csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)[1];
    const body=new URLSearchParams({csrf,userId:"u",action:"block",reason:"test access",requestId:"00000000-0000-4000-8000-000000000001"});
    const post=(headers,b=body)=>fetch(base+"/access",{method:"POST",headers,body:b,redirect:"manual"});
    assert.equal((await post({origin:base})).status,401);
    assert.equal((await post({authorization:auth,origin:"https://evil.example"})).status,403);
    assert.equal((await post({authorization:auth,origin:base},new URLSearchParams({...Object.fromEntries(body),csrf:"0".repeat(64)}))).status,403);
    assert.equal((await post({authorization:auth,origin:base})).status,303);
    assert.ok(s.db.users[0].blockedAt);assert.equal(s.db.sessions.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
