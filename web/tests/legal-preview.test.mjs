import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {renderLegalPreview,createAdminDashboard} from "../admin-dashboard.mjs";
const bundle={status:"draft",version:"test",documents:{offer:"<script>bad</script>",privacy:"policy",consent:"consent"}};
test("private draft preview escapes documents and cannot collect agreement",()=>{
 const html=renderLegalPreview(bundle);
 assert.ok(html.includes("&lt;script&gt;bad&lt;/script&gt;"));
 assert.ok(!html.includes("<script>"));
 assert.ok(html.includes('type="checkbox" disabled'));
 assert.ok(html.includes("Проекты не опубликованы"));
 assert.throws(()=>renderLegalPreview({...bundle,status:"approved"}));
});
test("legal preview requires admin authentication, cannot accept posts",async()=>{
 const key="a".repeat(64);
 const server=createAdminDashboard({db:{}},{secret:key,legalPreview:()=>bundle});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const url="http://127.0.0.1:"+server.address().port+"/legal-preview";
 const authorization="Basic "+Buffer.from("admin:"+key).toString("base64");
 try{
  assert.equal((await fetch(url)).status,401);
  const response=await fetch(url,{headers:{authorization}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.ok((await response.text()).includes("Юридические документы"));
  assert.equal((await fetch(url,{method:"POST",headers:{authorization}})).status,405);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
