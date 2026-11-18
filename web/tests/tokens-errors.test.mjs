import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {Store} from "../core.mjs";

test("failed AI calls do not debit public tokens, and retries are idempotent",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"al-token-"));
  const provider=path.join(temp,"provider.mjs");
  fs.writeFileSync(provider,String.raw`
    globalThis.fetch=async (url,options)=>{
      if(url!=="https://api.openai.com/v1/responses") throw Error("Unexpected request");
      const payload=JSON.parse(options.body);
      const message=payload.input.at(-1).content[0].text;
      if(message==="FAIL")return Response.json({error:{code:"provider_503"}},{status:503});
      if(message==="EMPTY")return Response.json({output:[]});
      return Response.json({output:[{type:"message",content:[{type:"output_text",text:"Готовый ответ"}]}]});
    };
  `);
  const key=crypto.randomBytes(32).toString("hex");
  const server=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const env={PORT:"0",HOST:"127.0.0.1",DATA_DIR:temp,DATA_KEY:key,
    OPENAI_API_KEY:"test-provider",ENABLE_LAW_SEARCH:"0",SIGNUP_INVITE_CODE:"invite-test"};
  let child,base;
  async function start(){
    child=spawn(process.execPath,["--import",provider,server],{env,stdio:["ignore","pipe","inherit"]});
    const started=await Promise.race([
      once(child.stdout,"data").then(([buf])=>buf.toString()),
      once(child,"exit").then(([code])=>{throw Error("Server exited: "+code);})
    ]);
    const port=started.match(/AI Lawyer web listening on ([0-9]+)/)?.[1];
    assert.ok(port);
    base="http://127.0.0.1:"+port;
  }
  async function stop(){
    if(!child || child.exitCode!==null)return;
    const exited=once(child,"exit");child.kill();await exited;
  }
  const call=(route,cookie,body)=>fetch(base+"/chat/api"+route,{
    method:body===undefined?"GET":"POST",
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{"content-type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  try{
    await start();
    const guestStart=await call("/guest");
    const guestCookie=guestStart.headers.get("set-cookie").split(";")[0];
    const initial=await guestStart.json();
    assert.equal(initial.tokenLimit,20000);
    assert.equal(initial.tokenBalance,20000);
    const failedGuest=await call("/guest/chat",guestCookie,{message:"FAIL",requestId:crypto.randomUUID()});
    assert.equal(failedGuest.status,502);
    const guestAfter=await (await call("/guest",guestCookie)).json();
    assert.equal(guestAfter.used,0);
    assert.equal(guestAfter.tokenBalance,20000,"failed model request must not spend user tokens");
    const guestRequestId=crypto.randomUUID();
    const guestDone=await call("/guest/chat",guestCookie,{message:"OK",requestId:guestRequestId});
    assert.equal(guestDone.status,200);
    assert.equal((await guestDone.json()).tokenBalance,18500);
    const duplicateGuest=await (await call("/guest/chat",guestCookie,{message:"OK",requestId:guestRequestId})).json();
    assert.equal(duplicateGuest.tokenBalance,18500);
    assert.equal(duplicateGuest.alreadyProcessed,true);

    const signup=await call("/auth/register",null,{email:"credits@example.kz",password:"verylongpassword1",invite:"invite-test"});
    assert.equal(signup.status,201);
    const cookie=signup.headers.get("set-cookie").split(";")[0];
    const db=new Store(temp,Buffer.from(key,"hex"));
    const user=db.db.users.find(x=>x.email==="credits@example.kz");
    assert.ok(user);
    // Seed a finite account with 45 internal credits to verify 15-credit spending.
    await stop();
    const persisted=new Store(temp,Buffer.from(key,"hex"));
    persisted.db.users.find(x=>x.email==="credits@example.kz").credits=45;
    persisted.save();
    await start();
    const profile=await (await call("/session",cookie)).json();
    assert.equal(profile.balance,4500);
    assert.equal(profile.prices.consult,1500);
    assert.equal(profile.prices.strategy,12000);
    assert.equal(profile.dailyLimit,20000);
    const create=await call("/cases",cookie,{title:"Тестовое дело",objective:"Проверить списание"});
    assert.equal(create.status,201);
    const caseId=(await create.json()).case.id;
    const chat=(message,requestId)=>call("/cases/"+caseId+"/chat",cookie,{message,mode:"consult",requestId});
    const firstFail=await chat("FAIL",crypto.randomUUID());
    assert.equal(firstFail.status,502);
    const empty=await chat("EMPTY",crypto.randomUUID());
    assert.equal(empty.status,502);
    const afterFails=await (await call("/cases",cookie)).json();
    assert.equal(afterFails.balance,4500);
    assert.equal(afterFails.usedToday,0);
    const requestId=crypto.randomUUID();
    const success=await chat("OK",requestId);
    assert.equal(success.status,200);
    const paid=await success.json();
    assert.equal(paid.cost,1500);
    assert.equal(paid.balance,3000);
    const duplicate=await chat("OK",requestId);
    assert.equal(duplicate.status,200);
    const dedup=await duplicate.json();
    assert.equal(dedup.alreadyProcessed,true);
    assert.equal(dedup.cost,0);
    assert.equal(dedup.balance,3000);
    const after=await (await call("/cases/"+caseId,cookie)).json();
    assert.equal(after.messages.length,2);
    assert.equal(after.messages[1].requestId,requestId);
    const wrong=await chat("Different prompt",requestId);
    assert.equal(wrong.status,409);
    const balance=await (await call("/cases",cookie)).json();
    assert.equal(balance.balance,3000);
    assert.equal(balance.usedToday,1500);
  }finally{
    await stop();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
