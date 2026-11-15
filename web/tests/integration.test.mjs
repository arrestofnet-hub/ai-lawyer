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
  const env={...process.env, PORT:String(port), HOST:"127.0.0.1", PUBLIC_ORIGIN:base,
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
    const page=await fetch(base+"/chat/");
    assert.equal(page.status,200);
    assert.match(await page.text(),/AI Lawyer Kazakhstan/);
    const make = async (email)=> {
      const r=await fetch(base+"/chat/api/auth/register",{method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({email,password:"secure-test-password-123",invite:"invite-for-test"})});
      assert.equal(r.status,201);const cookie=r.headers.get("set-cookie").split(";")[0];
      return cookie;
    };
    const a=await make("a@example.kz"), b=await make("b@example.kz");
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
