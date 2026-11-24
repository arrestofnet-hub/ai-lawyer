import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("global guest cost guard is shared across IPs and survives restart", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),"al-guest-budget-"));
  const provider = path.join(temp,"model.mjs");
  fs.writeFileSync(provider,`
    globalThis.fetch = async (url) => {
      if (url !== "https://api.openai.com/v1/responses") throw Error("Unexpected outbound request");
      return Response.json({ output:[{type:"message",content:[{type:"output_text",text:"Ответ"}]}] });
    };
  `);
  const server = fileURLToPath(new URL("../server.mjs",import.meta.url));
  const env = {
    PORT:"0",HOST:"127.0.0.1",DATA_DIR:temp,DATA_KEY:crypto.randomBytes(32).toString("hex"),
    OPENAI_API_KEY:"integration-test",ENABLE_LAW_SEARCH:"0",
    GUEST_GLOBAL_24H_MAX:"2",GUEST_IP_30D_MAX:"20"
  };
  let child, base;
  async function start() {
    child=spawn(process.execPath,["--import",provider,server],{env,stdio:["ignore","pipe","inherit"]});
    const startup=await Promise.race([
      once(child.stdout,"data").then(([chunk])=>chunk.toString()),
      once(child,"exit").then(([code])=>{throw Error("Server exited: "+code);})
    ]);
    const port=startup.match(/AI Lawyer web listening on (\d+)/)?.[1];
    assert.ok(port);
    base="http://127.0.0.1:"+port;
  }
  async function stop() {
    if(!child || child.exitCode!==null)return;
    const exited=once(child,"exit");
    child.kill();await exited;
  }
  const request=(route,ip,cookie,body)=>fetch(base+"/chat/api"+route,{
    method:body===undefined?"GET":"POST",
    headers:{"x-real-ip":ip,...(cookie?{cookie}:{}),...(body?{"content-type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  try {
    await start();
    for (const ip of ["203.0.113.11","198.51.100.22"]) {
      const startResponse=await request("/guest",ip);
      assert.equal(startResponse.status,200);
      const cookie=startResponse.headers.get("set-cookie").split(";")[0];
      assert.equal((await request("/guest/chat",ip,cookie,{message:"Проверка"})).status,200);
    }
    const third=await request("/guest","192.0.2.33");
    assert.equal(third.status,200);
    assert.equal(third.headers.get("set-cookie"),null);
    const state=await third.json();
    assert.equal(state.remaining,0);
    assert.match(state.restriction,/Суточный лимит/);
    await stop();await start();
    const afterRestart=await request("/guest","192.0.2.44");
    assert.equal((await afterRestart.json()).remaining,0);
  } finally {
    await stop();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
