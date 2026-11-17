import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Store, hashPassword } from "../core.mjs";
import { emailCodeHash } from "../auth.mjs";

test("guest exports, email confirmation after lost cookie, and existing-account login preserve cases",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"al-history-"));
  const provider=path.join(temp,"model.mjs");
  fs.writeFileSync(provider,`
    globalThis.fetch=async (url)=>{
      if(url!=="https://api.openai.com/v1/responses")throw Error("Unexpected request");
      return Response.json({output:[{type:"message",content:[{type:"output_text",text:"## Правовой анализ\\nТекст ответа для Word и PDF."}]}]});
    };
  `);
  const key=crypto.randomBytes(32).toString("hex");
  const file=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const env={PORT:"0",HOST:"127.0.0.1",DATA_DIR:temp,DATA_KEY:key,
    OPENAI_API_KEY:"integration-test",ENABLE_LAW_SEARCH:"0",SIGNUP_INVITE_CODE:"invite-test"};
  let child,base;
  async function start(){
    child=spawn(process.execPath,["--import",provider,file],{env,stdio:["ignore","pipe","inherit"]});
    const output=await Promise.race([
      once(child.stdout,"data").then(([b])=>b.toString()),
      once(child,"exit").then(([code])=>{throw Error("Server exited: "+code);})
    ]);
    const port=output.match(/AI Lawyer web listening on ([0-9]+)/)?.[1];
    assert.ok(port);
    base="http://127.0.0.1:"+port;
  }
  async function stop(){
    if(!child||child.exitCode!==null)return;
    const exited=once(child,"exit");child.kill();await exited;
  }
  function call(path,cookie,body){
    return fetch(base+"/chat/api"+path,{
      method:body===undefined?"GET":"POST",
      headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{"content-type":"application/json"})},
      body:body===undefined?undefined:JSON.stringify(body)
    });
  }
  async function checkFile(route,cookie,signature,contentType){
    const response=await call(route,cookie);
    if(response.status!==200)throw Error(route+" returned "+response.status+": "+await response.text());
    assert.match(response.headers.get("content-type")||"",contentType);
    const file=Buffer.from(await response.arrayBuffer());
    assert.ok(file.length>250);
    assert.equal(file.subarray(0,signature.length).toString("utf8"),signature);
  }
  try {
    await start();
    const first=await call("/guest");
    assert.equal(first.status,200);
    const cookie=first.headers.get("set-cookie").split(";")[0];
    await first.json();
    for(let i=0;i<2;i++)assert.equal((await call("/guest/chat",cookie,{message:"Вопрос "+i})).status,200);
    const guestData=await (await call("/guest",cookie)).json();
    const assistant=guestData.messages.find(m=>m.role==="assistant");
    assert.ok(assistant?.id);
    await checkFile("/guest/export/"+assistant.id+"?format=docx",cookie,"PK",/wordprocessingml/);
    await checkFile("/guest/export/"+assistant.id+"?format=pdf",cookie,"%PDF",/application[/]pdf/);
    assert.equal((await call("/guest/export/"+assistant.id+"?format=pdf")).status,401);
    await stop();

    // The guest cookie can disappear between email-start and email-verify.
    // Registration must still attach the guest identified at email-start.
    const db=new Store(temp,Buffer.from(key,"hex"));
    const guest=db.db.guests.find(g=>g.messages?.length===4);
    assert.ok(guest);
    const email="client@example.kz",password="long-test-password",code="147258";
    db.db.pendingSignups=[{
      email,pass:hashPassword(password),codeHash:emailCodeHash(email,code,Buffer.from(key,"hex")),
      guestHash:guest.hash,referralCode:"",referralSource:"",attempts:0,
      expiresAt:Date.now()+600000,remember:true
    }];
    db.save();
    await start();

    const verified=await call("/auth/email-verify",null,{email,code});
    assert.equal(verified.status,201);
    const registered=await verified.json();
    assert.ok(registered.guestCaseId);
    const sessionCookie=verified.headers.get("set-cookie").split(";")[0];
    const cases=await (await call("/cases",sessionCookie)).json();
    assert.equal(cases.cases.length,1);
    const saved=await (await call("/cases/"+registered.guestCaseId,sessionCookie)).json();
    assert.equal(saved.messages.length,4);
    const migratedAssistant=saved.messages.find(m=>m.role==="assistant");
    await checkFile("/cases/"+registered.guestCaseId+"/export/"+migratedAssistant.id+"?format=docx",sessionCookie,"PK",/wordprocessingml/);
    await checkFile("/cases/"+registered.guestCaseId+"/export/"+migratedAssistant.id+"?format=pdf",sessionCookie,"%PDF",/application[/]pdf/);

    // Logging into an existing account must not discard the new guest's chat.
    const nextGuest=await call("/guest");
    const nextCookie=nextGuest.headers.get("set-cookie").split(";")[0];
    assert.equal((await call("/guest/chat",nextCookie,{message:"Новая беседа"})).status,200);
    const login=await call("/auth/login",nextCookie,{email,password});
    assert.equal(login.status,200);
    const loginData=await login.json();
    assert.ok(loginData.guestCaseId);
    const accountCookie=login.headers.get("set-cookie").split(";")[0];
    const after=await (await call("/cases",accountCookie)).json();
    assert.equal(after.cases.length,2);
    const newest=await (await call("/cases/"+loginData.guestCaseId,accountCookie)).json();
    assert.equal(newest.messages.length,2);
    // No second transfer of the same guest messages.
    const again=await call("/auth/login",nextCookie,{email,password});
    assert.equal((await again.json()).guestCaseId,null);
  }finally{
    await stop();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
