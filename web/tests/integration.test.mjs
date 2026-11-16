import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("isolated accounts, sessions, documents and API failures",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"al-integration-"));
  const port=21000+Math.floor(Math.random()*12000);
  const base="http://127.0.0.1:"+port;
  const adminKey=crypto.randomBytes(32).toString("hex");
  const env={...process.env, REFERRAL_ADMIN_KEY:adminKey, PORT:String(port), HOST:"127.0.0.1", PUBLIC_ORIGIN:base,
    DATA_DIR:temp, DATA_KEY:crypto.randomBytes(32).toString("hex"), SIGNUP_INVITE_CODE:"invite-for-test",
    OPENAI_API_KEY:""};
  const filename=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","server.mjs");
  const child=spawn(process.execPath,[filename],{env,stdio:"ignore"});
  try{
    let ready=false;
    for(let i=0;i<80;i++){
      if(child.exitCode!==null) throw new Error("Web server exited");
      try{const r=await fetch(base+"/chat/health");if(r.ok){ready=true;break;}}catch{}
      await delay(100);
    }
    assert.equal(ready,true,"server should start");
    const initial=await (await fetch(base+"/chat/api/session")).json();
    assert.equal(initial.signupMode,"invite");
    assert.equal(initial.googleEnabled,false);
    assert.equal((await fetch(base+"/chat/auth/google/start")).status,503);
    const blockedCampaign=await fetch(base+"/chat/api/admin/referrals",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({partner:"Test Campaign",maxRedemptions:2})
    });
    assert.equal(blockedCampaign.status,403,"campaign creation is not public");
    const makeCampaign=await fetch(base+"/chat/api/admin/referrals",{
      method:"POST",headers:{"content-type":"application/json","x-ai-lawyer-admin-key":adminKey},
      body:JSON.stringify({partner:"Test Campaign",maxRedemptions:2})
    });
    assert.equal(makeCampaign.status,201);
    const campaign=await makeCampaign.json();
    assert.match(campaign.link,/\/chat\/\?ref=[A-Z0-9]{12}$/);
    assert.equal(campaign.campaign.credits,50);
    const campaignStats=await fetch(base+"/chat/api/admin/referrals",{
      headers:{"x-ai-lawyer-admin-key":adminKey}
    });
    assert.equal(campaignStats.status,200);
    assert.equal((await campaignStats.json()).campaigns[0].redemptions,0,"no bonus before verification");

    const page=await fetch(base+"/chat/");
    assert.equal(page.status,200);
    const html=await page.text();
    assert.match(html,/AI Lawyer Kazakhstan/);
    assert.match(html,/id="attachShortcut"/);
    assert.match(html,/id="selectedCount"/);
    assert.match(html,/id="modeHint"/);
    assert.match(html,/id="remember"/);
    assert.match(html,/id="googleLogin"/);
    assert.match(html,/id="verifyCode"/);
    assert.match(html,/id="confirmPassword"/);
    assert.match(html,/id="showPassword"/);
    assert.match(html,/id="forgotPassword"/);
    assert.match(html,/id="resetForm"/);
    assert.match(html,/id="resetCode"/);
    assert.match(html,/help@ailawyer.kz/);
    assert.match(html,/id="referralCode"/);
    assert.match(html,/id="referralHelp"/);
    assert.match(html,/id="legacyInviteToggle"/);
    const frontend=await fetch(base+"/chat/app.js");
    assert.equal(frontend.status,200);
    const js=await frontend.text();
    assert.match(js,/updateSelectedCount/);
    assert.match(js,/attachShortcut/);
    const make = async (email)=> {
      const r=await fetch(base+"/chat/api/auth/register",{method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({email,password:"secure-test-password-123",invite:"invite-for-test"})});
      assert.equal(r.status,201);const cookie=r.headers.get("set-cookie").split(";")[0];
      return cookie;
    };
    const a=await make("a@example.kz"), b=await make("b@example.kz");
    const legacySession=await fetch(base+"/chat/api/session",{headers:{cookie:a}});
    const legacy=await legacySession.json();
    assert.equal(legacy.balance,null,"existing invite accounts preserve legacy limit");
    assert.equal(legacy.dailyLimit,25);
    assert.equal(legacy.prices.consult,1);
    const blockedEmail=await fetch(base+"/chat/api/auth/email-start",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"unverified@example.kz",password:"valid-password-123",referralCode:campaign.campaign.code})
    });
    assert.equal(blockedEmail.status,503,"email signup remains disabled without SMTP");

    const noRecovery=await fetch(base+"/chat/api/auth/password-reset-start",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"a@example.kz"})
    });
    assert.equal(noRecovery.status,503,"reset requires email service");
    const noResetComplete=await fetch(base+"/chat/api/auth/password-reset-complete",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"a@example.kz",code:"123456",password:"long-new-password"})
    });
    assert.equal(noResetComplete.status,503);

    const regularLogin=await fetch(base+"/chat/api/auth/login",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"a@example.kz",password:"secure-test-password-123",remember:false})
    });
    assert.equal(regularLogin.status,200);
    assert.doesNotMatch(regularLogin.headers.get("set-cookie"),/Max-Age=/i);
    const rememberedLogin=await fetch(base+"/chat/api/auth/login",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"a@example.kz",password:"secure-test-password-123",remember:true})
    });
    assert.equal(rememberedLogin.status,200);
    assert.match(rememberedLogin.headers.get("set-cookie"),/Max-Age=2592000/);
    const noMail=await fetch(base+"/chat/api/auth/email-start",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"c@example.kz",password:"secure-test-password-123"})
    });
    assert.equal(noMail.status,503);

    const call=async(cookie,route,method="GET",body,headers={})=>{
      const r=await fetch(base+"/chat/api"+route,{method,headers:{cookie,...headers,...(body && typeof body==="object" && !Buffer.isBuffer(body)?{"content-type":"application/json"}:{})},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
      return {status:r.status,data:await r.json()};
    };
    const newCase=await call(a,"/cases","POST",{title:"Секретное дело",objective:"Проверка"});
    assert.equal(newCase.status,201);const id=newCase.data.case.id;
    const own=await call(a,"/cases/"+id);assert.equal(own.status,200);
    const other=await call(b,"/cases/"+id);assert.equal(other.status,404);
    const bytes=Buffer.from("%PDF-1.7\nClient A private contract");
    const d=await call(a,"/cases/"+id+"/documents","POST",bytes,{"x-filename":"contract.pdf"});
    assert.equal(d.status,201);
    const blocked=await call(b,"/cases/"+id+"/documents","POST",bytes,{"x-filename":"contract.pdf"});
    assert.equal(blocked.status,404);
    const localDatabase=fs.readFileSync(path.join(temp,"database.enc"));
    assert.equal(localDatabase.includes(Buffer.from("Секретное дело")),false);
    const noKey=await call(a,"/cases/"+id+"/chat","POST",{message:"Проверь договор",mode:"audit"});
    assert.equal(noKey.status,503);
    const originError=await call(a,"/cases/"+id,"PATCH",{title:"Злоумышленник"},{"origin":"https://evil.example"});
    assert.equal(originError.status,403);
    const after=await call(a,"/cases/"+id);
    assert.equal(after.data.messages.length,0);
    assert.equal(after.data.documents.length,1);
    const deleted=await call(a,"/cases/"+id,"DELETE",{confirm:"УДАЛИТЬ"});
    assert.equal(deleted.status,200);
    assert.equal((await call(a,"/cases/"+id)).status,404);
  }finally{
    child.kill("SIGTERM");
    await delay(100);
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
