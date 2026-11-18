import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import {Store} from "../core.mjs";

test("dossier API preserves private user source links, revisions and evidence memory without API spending",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"al-dossier-http-"));
  const port=20000+Math.floor(Math.random()*10000);
  const base="http://127.0.0.1:"+port+"/chat/api";
  const key=crypto.randomBytes(32).toString("hex");
  const env={...process.env,PORT:String(port),HOST:"127.0.0.1",DATA_DIR:dir,DATA_KEY:key,
    OPENAI_API_KEY:"",SIGNUP_INVITE_CODE:"dossier-test-code",ENABLE_LAW_SEARCH:"0"};
  const file=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const child=spawn(process.execPath,[file],{env,stdio:["ignore","pipe","inherit"]});
  async function call(route,cookie,method="GET",body,filename){
    const options={method,headers:{...(cookie?{cookie}:{}),
      ...(filename?{"x-filename":filename}:{}),
      ...(!filename&&body!==undefined?{"content-type":"application/json"}:{})}};
    if(body!==undefined)options.body=filename?body:JSON.stringify(body);
    const response=await fetch(base+route,options);
    return {status:response.status,data:await response.json()};
  }
  try{
    let ready=false;
    for(let n=0;n<80;n++){
      if(child.exitCode!==null)throw Error("server exited");
      try{if((await fetch(base+"/legal/status")).ok){ready=true;break;}}catch{}
      await sleep(70);
    }
    assert.equal(ready,true,"server must start");
    const local=await call("/legal/status");
    assert.equal(local.data.ready,false);
    assert.equal(local.data.passages,0);
    const signup=async(email)=>{
      const r=await fetch(base+"/auth/register",{method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({email,password:"SecurePassword1234!",invite:"dossier-test-code"})});
      assert.equal(r.status,201);
      return r.headers.get("set-cookie").split(";")[0];
    };
    const a=await signup("one@example.kz"),b=await signup("two@example.kz");
    const created=await call("/cases",a,"POST",{title:"Тестовое дело",objective:"Отменить спорный арест"});
    assert.equal(created.status,201);
    const caseId=created.data.case.id;
    const owner=await call("/cases/"+caseId+"/dossier",a);
    assert.equal(owner.status,200);assert.equal(owner.data.dossier.revision,0);
    assert.deepEqual(owner.data.chronology,[]);
    assert.equal((await call("/cases/"+caseId+"/dossier",b)).status,404);
    const fileData=Buffer.from("Обезличенный фрагмент документа 12.11.2026");
    const uploaded=await call("/cases/"+caseId+"/documents",a,"POST",fileData,"exhibit.txt");
    assert.equal(uploaded.status,201);
    const docId=uploaded.data.document.id;
    const annotation={revision:0,nextStep:"Получить подтверждение вручения",
      facts:[{statement:"Дата получения заявления — 12 ноября",
        category:"notice",status:"supported",eventDate:"2026-11-12",
        sourceIds:[docId],note:"Проверить оригинал входящей отметки"}],
      tasks:[{title:"Направить запрос о вручении",state:"open",dueDate:"2026-11-30",note:"Контрольная дата"}]};
    const save=await call("/cases/"+caseId+"/dossier",a,"PATCH",annotation);
    assert.equal(save.status,200);assert.equal(save.data.dossier.revision,1);
    assert.equal(save.data.dossier.facts.length,1);
    const old=await call("/cases/"+caseId+"/dossier",a,"PATCH",annotation);
    assert.equal(old.status,409,"outdated revision must not overwrite newer dossier");
    const cross=await call("/cases/"+caseId+"/dossier",a,"PATCH",
      {...annotation,revision:1,facts:[{...annotation.facts[0],
        sourceIds:[crypto.randomUUID()]}]});
    assert.equal(cross.status,400,"source IDs from other matters must be rejected");
    assert.equal((await call("/cases/"+caseId+"/dossier",b,"PATCH",
      {...annotation,revision:1})).status,404);
    const view=await call("/cases/"+caseId+"/dossier",a);
    assert.equal(view.data.dossier.facts[0].sourceIds[0],docId);
    assert.equal(view.data.sources[0].id,docId);
    assert.match(view.data.warnings[0],/не установленные юридические факты/);
    const raw=fs.readFileSync(path.join(dir,"database.enc"));
    assert.equal(raw.includes(Buffer.from("Дата получения заявления")),false,
      "memory text must remain AES encrypted");
    const persisted=new Store(dir,Buffer.from(key,"hex"));
    assert.equal(persisted.getCase(persisted.db.users[0].id,caseId).dossier.revision,1);
    const del=await call("/cases/"+caseId,a? a:null,"DELETE",{confirm:"УДАЛИТЬ"});
    assert.equal(del.status,200);
    assert.equal((await call("/cases/"+caseId+"/dossier",a)).status,404);
  }finally{
    const exit=new Promise(resolve=>child.once("exit",resolve));
    if(child.exitCode===null){child.kill("SIGTERM");await exit;}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
