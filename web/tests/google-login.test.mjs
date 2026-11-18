import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";

test("Google OAuth safely registers new users, restores guest chat, and logs into existing account",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"al-google-e2e-"));
  const server=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const provider=fileURLToPath(new URL("./mock-google-provider.mjs",import.meta.url));
  const port=23000+Math.floor(Math.random()*10000);
  const base="http://127.0.0.1:"+port;
  const key=crypto.randomBytes(32).toString("hex");
  const common={...process.env,PORT:String(port),HOST:"127.0.0.1",PUBLIC_ORIGIN:base,
    DATA_DIR:dir,DATA_KEY:key,OPENAI_API_KEY:"test-model",
    GOOGLE_CLIENT_ID:"test-oauth.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET:"mock-secret-only",ENABLE_LAW_SEARCH:"0",
    GOOGLE_SIGNUP_ENABLED:"1"};
  let child;
  async function start(env=common){
    child=spawn(process.execPath,["--import",provider,server],{env,stdio:["ignore","pipe","inherit"]});
    let ready=false;
    for(let i=0;i<80;i++){
      if(child.exitCode!==null)throw Error("Server exited");
      try { if((await fetch(base+"/chat/health")).ok){ready=true;break;} } catch{}
      await delay(80);
    }
    assert.ok(ready,"Server never started");
  }
  async function stop(){
    if(!child||child.exitCode!==null)return;
    const closed=once(child,"exit");child.kill();await closed;
  }
  async function call(url,cookie,body){
    return fetch(base+url,{redirect:"manual",method:body===undefined?"GET":"POST",
      headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{"content-type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function beginGoogle(guestCookie,remember=false){
    const start=await call("/chat/auth/google/start?remember="+(remember?1:0),guestCookie);
    assert.equal(start.status,302);
    const u=new URL(start.headers.get("location"));
    assert.equal(u.hostname,"accounts.google.com");
    assert.equal(u.searchParams.get("redirect_uri"),base+"/chat/auth/google/callback");
    const oauthCookie=start.headers.get("set-cookie").split(";")[0];
    return {state:u.searchParams.get("state"),code:u.searchParams.get("nonce"),cookie:
      [guestCookie,oauthCookie].filter(Boolean).join("; ")};
  }
  async function completeGoogle(flow,code=flow.code){
    const r=await call("/chat/auth/google/callback?state="+encodeURIComponent(flow.state)+
      "&code="+encodeURIComponent(code),flow.cookie);
    assert.equal(r.status,303);
    return r;
  }
  try{
    await start();
    const initial=await (await call("/chat/api/session")).json();
    assert.equal(initial.googleEnabled,true);
    assert.equal(initial.googleSignupEnabled,true);
    const guest=await call("/chat/api/guest");
    const guestCookie=guest.headers.get("set-cookie").split(";")[0];
    assert.equal((await call("/chat/api/guest/chat",guestCookie,
      {message:"Тестовое дело",mode:"consult"})).status,200);
    const flow=await beginGoogle(guestCookie,true);
    const signedIn=await completeGoogle(flow);
    assert.match(signedIn.headers.get("location"),/auth_notice=google_registered/);
    const cookie=signedIn.headers.getSetCookie().find(x=>x.startsWith("al_session=")).split(";")[0];
    const session=await (await call("/chat/api/session",cookie)).json();
    assert.equal(session.authenticated,true);
    assert.equal(session.user.email,"google-test@example.kz");
    assert.equal(session.user.googleLinked,true);
    assert.equal(session.balance,38500);
    const cases=await (await call("/chat/api/cases",cookie)).json();
    assert.equal(cases.cases.length,1);
    const restored=await (await call("/chat/api/cases/"+cases.cases[0].id,cookie)).json();
    assert.equal(restored.messages.length,2);
    assert.equal(restored.messages[1].text,"Тестовый юридический ответ");
    const existing=await completeGoogle(await beginGoogle(null));
    assert.equal(existing.headers.get("location"),base+"/chat/");
    const existingCookie=existing.headers.getSetCookie().find(x=>x.startsWith("al_session=")).split(";")[0];
    assert.equal((await (await call("/chat/api/session",existingCookie)).json()).authenticated,true);

    const badFlow=await beginGoogle(null);
    const timedOut=await completeGoogle(badFlow,"fail-network");
    assert.match(timedOut.headers.get("location"),/auth_error=google_network_failed/);
    const badState=await call("/chat/auth/google/callback?code=wrong&state=wrong");
    assert.match(badState.headers.get("location"),/auth_error=google_state_invalid/);
  } finally {
    await stop();fs.rmSync(dir,{recursive:true,force:true});
  }
});

test("Google OAuth distinguishes disabled new signup, without claiming successful login",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"al-google-disabled-"));
  const server=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const provider=fileURLToPath(new URL("./mock-google-provider.mjs",import.meta.url));
  const port=24000+Math.floor(Math.random()*10000);
  const base="http://127.0.0.1:"+port;
  const env={...process.env,PORT:String(port),HOST:"127.0.0.1",PUBLIC_ORIGIN:base,
    DATA_DIR:dir,DATA_KEY:crypto.randomBytes(32).toString("hex"),
    OPENAI_API_KEY:"test-model",ENABLE_LAW_SEARCH:"0",
    GOOGLE_CLIENT_ID:"test-oauth.apps.googleusercontent.com",GOOGLE_CLIENT_SECRET:"mock-secret-only",
    GOOGLE_SIGNUP_ENABLED:"0",GOOGLE_TEST_EMAIL:"new-only@example.kz"};
  const child=spawn(process.execPath,["--import",provider,server],{env,stdio:["ignore","pipe","inherit"]});
  try{
    let ready=false;
    for(let i=0;i<80;i++){
      if(child.exitCode!==null)throw Error("Server exited");
      try{if((await fetch(base+"/chat/health")).ok){ready=true;break;}}catch{}
      await delay(80);
    }
    assert.ok(ready);
    const flags=await (await fetch(base+"/chat/api/session")).json();
    assert.equal(flags.googleEnabled,true);assert.equal(flags.googleSignupEnabled,false);
    const begin=await fetch(base+"/chat/auth/google/start",{redirect:"manual"});
    const url=new URL(begin.headers.get("location"));
    const oauthCookie=begin.headers.get("set-cookie").split(";")[0];
    const r=await fetch(base+"/chat/auth/google/callback?state="+url.searchParams.get("state")+
      "&code="+url.searchParams.get("nonce"),{redirect:"manual",headers:{cookie:oauthCookie}});
    assert.equal(r.status,303);
    assert.match(r.headers.get("location"),/auth_error=google_signup_disabled/);
    const session=await (await fetch(base+"/chat/api/session")).json();
    assert.equal(session.authenticated,false);
  }finally{
    const exited=once(child,"exit");child.kill();await exited;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
