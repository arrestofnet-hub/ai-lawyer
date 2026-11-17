import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("guest quota, persistence and registration handoff", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),"al-guest-"));
  const provider = path.join(temp,"model.mjs");
  fs.writeFileSync(provider,`
    globalThis.fetch = async (url, options) => {
      if (url !== "https://api.openai.com/v1/responses") throw Error("Unexpected outbound request");
      const message = JSON.parse(options.body).input.at(-1).content[0].text;
      if (message === "Ошибочный запрос") return Response.json({}, { status: 500 });
      if (message === "Параллельный запрос") await new Promise(resolve => setTimeout(resolve, 100));
      return Response.json({ output: [{ type:"message", content:[{ type:"output_text", text:"Ответ" }] }] });
    };
  `);
  const file = fileURLToPath(new URL("../server.mjs",import.meta.url));
  const env = {
    PORT:"0",HOST:"127.0.0.1",DATA_DIR:temp,DATA_KEY:crypto.randomBytes(32).toString("hex"),
    OPENAI_API_KEY:"integration-test",ENABLE_LAW_SEARCH:"0",SIGNUP_INVITE_CODE:"test-invite"
  };
  let child, base;
  async function start() {
    child = spawn(process.execPath,["--import",provider,file],{env,stdio:["ignore","pipe","inherit"]});
    const startup = await Promise.race([
      once(child.stdout,"data").then(([chunk])=>chunk.toString()),
      once(child,"exit").then(([code])=>{throw Error("Server exited: "+code);})
    ]);
    const port = startup.match(/AI Lawyer web listening on (\d+)/)?.[1];
    assert.ok(port && Number(port) > 0);
    base = "http://127.0.0.1:"+port;
  }
  async function stop() {
    if(!child || child.exitCode !== null)return;
    const exited = once(child,"exit");
    child.kill();
    await exited;
  }
  const call = (route, cookie, body, headers={}) => fetch(base+"/chat/api"+route,{
    method:body===undefined?"GET":"POST",
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{"content-type":"application/json"}),...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  try {
    await start();
    const first = await call("/guest");
    assert.equal(first.status,200);
    assert.match(first.headers.get("set-cookie"),/HttpOnly; SameSite=Lax/);
    const cookie = first.headers.get("set-cookie").split(";")[0];
    assert.equal((await first.json()).remaining,20);
    assert.equal((await call("/guest/chat",undefined,{message:"Вопрос"})).status,409);
    assert.equal((await call("/guest/chat",cookie,{message:"Вопрос"},{origin:"https://other.example"})).status,403);
    assert.equal((await call("/guest/chat",cookie,{message:"Ошибочный запрос"})).status,502);
    assert.equal((await (await call("/guest",cookie)).json()).used,0);

    const parallel = await Promise.all([1,2].map(()=>call("/guest/chat",cookie,{message:"Параллельный запрос"})));
    assert.deepEqual(parallel.map(r=>r.status).sort(),[200,429]);
    for(let n=2;n<=20;n++){
      const answer = await call("/guest/chat",cookie,{message:"Вопрос "+n});
      assert.equal(answer.status,200);
      const data = await answer.json();
      assert.equal(data.used,n);
      assert.equal(data.messages.length,n*2);
      if(n===5){assert.equal(data.remaining,15);assert.equal(data.reminderAt,5);}
    }

    await stop();
    await start();
    assert.equal((await (await call("/guest",cookie)).json()).used,20);
    const blocked = await call("/guest/chat",cookie,{message:"Вопрос 21"});
    assert.equal(blocked.status,403);
    assert.equal((await blocked.json()).guest.remaining,0);
    assert.equal((await (await call("/guest")).json()).used,0);
    assert.equal((await (await call("/guest","al_guest="+"a".repeat(64))).json()).used,0);

    const signup = await call("/auth/register",cookie,{
      email:"guest@example.com",password:"long-test-password",invite:"test-invite"
    });
    assert.equal(signup.status,201);
    const account = signup.headers.get("set-cookie").split(";")[0];
    const cases = await (await call("/cases",account)).json();
    assert.equal(cases.cases.length,1);
    const saved = await (await call("/cases/"+cases.cases[0].id,account)).json();
    assert.equal(saved.messages.length,40);
    assert.equal((await call("/cases/"+cases.cases[0].id,cookie)).status,401);
    const usedGuest = await (await call("/guest",cookie)).json();
    assert.equal(usedGuest.remaining,0);
    assert.equal(usedGuest.messages.length,0);
  } finally {
    await stop();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
