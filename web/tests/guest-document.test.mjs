import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";

test("guest receives 20k tokens for ten consultations and one document, downloadable in Word/PDF",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"al-guest-document-"));
  const provider=path.join(temp,"model.mjs");
  fs.writeFileSync(provider,String.raw`
    globalThis.fetch=async (url,opts)=>{
      if(url!=="https://api.openai.com/v1/responses")throw Error("unexpected outbound request");
      const p=JSON.parse(opts.body);
      const message=p.input.at(-1).content[0].text;
      if(message==="Ошибка документа")return Response.json({error:{code:"temporary"}},{status:503});
      return Response.json({output:[{type:"message",content:[{type:"output_text",
        text:"**ПРОЕКТ ЗАЯВЛЕНИЯ**\\nНа основании изложенного прошу предоставить сведения."}]}]});
    };
  `);
  const file=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const env={PORT:"0",HOST:"127.0.0.1",DATA_DIR:temp,DATA_KEY:crypto.randomBytes(32).toString("hex"),
    OPENAI_API_KEY:"fake-test",ENABLE_LAW_SEARCH:"0",SIGNUP_INVITE_CODE:"test-code"};
  let child,base;
  async function start(){
    child=spawn(process.execPath,["--import",provider,file],{env,stdio:["ignore","pipe","inherit"]});
    const output=await Promise.race([
      once(child.stdout,"data").then(([b])=>b.toString()),
      once(child,"exit").then(([code])=>{throw Error("server exit "+code);})
    ]);
    const port=output.match(/AI Lawyer web listening on ([0-9]+)/)?.[1];assert.ok(port);
    base="http://127.0.0.1:"+port;
  }
  async function stop(){
    if(!child||child.exitCode!==null)return;
    const exited=once(child,"exit");child.kill();await exited;
  }
  const call=(route,ip,cookie,body)=>fetch(base+"/chat/api"+route,{
    method:body===undefined?"GET":"POST",
    headers:{"x-real-ip":ip,...(cookie?{cookie}:{}),...(body===undefined?{}:{"content-type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  try{
    await start();
    const ip="192.0.2.30";
    const opened=await call("/guest",ip);
    const cookie=opened.headers.get("set-cookie").split(";")[0];
    const first=await opened.json();
    assert.equal(first.limit,10);
    assert.equal(first.remaining,10);
    assert.equal(first.documentRemaining,1);
    assert.equal(first.documentTokenCost,5000);
    assert.equal(first.tokenLimit,20000);
    assert.equal(first.tokenBalance,20000);
    assert.equal((await call("/guest/chat",ip,cookie,{message:"Аудит",mode:"audit"})).status,400);

    for(let n=1;n<=10;n++){
      const response=await call("/guest/chat",ip,cookie,{message:"Консультация "+n,
        mode:"consult",requestId:crypto.randomUUID()});
      assert.equal(response.status,200);
      const body=await response.json();
      assert.equal(body.used,n);
      assert.equal(body.tokensUsed,n*1500);
      assert.equal(body.documentRemaining,1);
    }
    const afterConsult=await (await call("/guest",ip,cookie)).json();
    assert.equal(afterConsult.remaining,0);
    assert.equal(afterConsult.documentRemaining,1);
    assert.equal(afterConsult.tokenBalance,5000);
    const forbiddenConsult=await call("/guest/chat",ip,cookie,{message:"Ещё вопрос",mode:"consult"});
    assert.equal(forbiddenConsult.status,403);

    const requestId=crypto.randomUUID();
    const document=await call("/guest/chat",ip,cookie,{
      message:"Составь заявление в банк",mode:"draft",requestId
    });
    assert.equal(document.status,200);
    const data=await document.json();
    assert.equal(data.documentRemaining,0);
    assert.equal(data.used,10,"document does not add an eleventh consultation");
    assert.equal(data.tokensUsed,20000);
    assert.equal(data.tokenBalance,0);
    assert.equal(data.messages.length,22);
    assert.equal(data.messages.at(-1).mode,"draft");
    const duplicate=await call("/guest/chat",ip,cookie,{
      message:"Составь заявление в банк",mode:"draft",requestId
    });
    assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).alreadyProcessed,true);
    const secondDocument=await call("/guest/chat",ip,cookie,{
      message:"Составь второй иск",mode:"draft",requestId:crypto.randomUUID()
    });
    assert.equal(secondDocument.status,403);

    const id=data.messages.at(-1).id;
    for(const [format,prefix,type] of [
      ["pdf","%PDF","application/pdf"],
      ["docx","PK","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
    ]){
      const response=await call("/guest/export/"+id+"?format="+format,ip,cookie);
      assert.equal(response.status,200);
      assert.match(response.headers.get("content-type"),new RegExp(type.replaceAll("/","[/]")));
      const bytes=Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length>300);
      assert.equal(bytes.subarray(0,prefix.length).toString(),prefix);
    }
    assert.equal((await call("/guest/export/"+id+"?format=pdf",ip)).status,401);

    const ip2="198.51.100.80";
    const opened2=await call("/guest",ip2);
    const cookie2=opened2.headers.get("set-cookie").split(";")[0];
    const draftFailed=await call("/guest/chat",ip2,cookie2,{
      message:"Ошибка документа",mode:"draft",requestId:crypto.randomUUID()
    });
    assert.equal(draftFailed.status,502);
    const afterFailed=await (await call("/guest",ip2,cookie2)).json();
    assert.equal(afterFailed.documentRemaining,1);
    assert.equal(afterFailed.tokenBalance,20000);
    const doc2=await call("/guest/chat",ip2,cookie2,{
      message:"Составь соглашение",mode:"draft",requestId:crypto.randomUUID()
    });
    assert.equal(doc2.status,200);
    const done2=await doc2.json();
    assert.equal(done2.documentRemaining,0);
    assert.equal(done2.remaining,10);
    assert.equal(done2.tokenBalance,15000,"document must NOT consume consultation allowance");
  }finally{
    await stop();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
