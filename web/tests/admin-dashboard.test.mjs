import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {adminSummary,renderAdmin,createAdminDashboard,adminAuthorizedRequest} from "../admin-dashboard.mjs";
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
test("dashboard HTTP endpoints require authentication and cannot write",async()=>{
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
