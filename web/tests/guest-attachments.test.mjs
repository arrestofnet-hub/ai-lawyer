import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";

test("guest uploads, Sol receives PDF, and registration retains encrypted attachment",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"al-guest-upload-"));
  const mock=path.join(temp,"mock.mjs");
  fs.writeFileSync(mock,[
    "globalThis.fetch=async(url,opts)=>{",
    "  if(url!=='https://api.openai.com/v1/responses')throw Error('unexpected outbound '+url);",
    "  const body=JSON.parse(opts.body);",
    "  const inputs=body.input.at(-1).content.filter(x=>x.type==='input_file');",
    "  const prompt=body.input.at(-1).content[0].text;",
    "  const required=prompt.includes('все три страницы')?12500:9500;",
    "  if(inputs.length&&body.max_output_tokens<required)throw Error('Document response budget too small');",
    "  if(inputs.some(x=>!x.file_data.startsWith('data:application/pdf;base64,')||",
    "    !Buffer.from(x.file_data.split(',')[1],'base64').toString('utf8').startsWith('%PDF-'))) ",
    "    throw Error('bad PDF bytes');",
    "  return Response.json({output:[{type:'message',content:[{type:'output_text',",
    "    text:'Прочитано PDF: '+inputs.length+' — '+inputs.map(x=>x.filename).join(', ')}]}]});",
    "};"
  ].join("\n"));
  const server=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const env={PORT:"0",HOST:"127.0.0.1",DATA_DIR:temp,
    DATA_KEY:crypto.randomBytes(32).toString("hex"),
    OPENAI_API_KEY:"fake",ENABLE_LAW_SEARCH:"0",SIGNUP_INVITE_CODE:"test-code"};
  let child,base;
  async function start(){
    child=spawn(process.execPath,["--import",mock,server],{
      env,stdio:["ignore","pipe","inherit"]});
    const started=await Promise.race([
      once(child.stdout,"data").then(([b])=>b.toString()),
      once(child,"exit").then(([code])=>{throw Error("Server exited "+code);})
    ]);
    const port=started.match(/AI Lawyer web listening on (\d+)/)?.[1];
    assert.ok(port,started);base="http://127.0.0.1:"+port;
  }
  async function stop(){
    if(!child||child.exitCode!==null)return;
    const exited=once(child,"exit");child.kill();await exited;
  }
  const call=(route,{cookie=null,method="GET",data,filename,origin}={})=>fetch(
    base+"/chat/api"+route,{
      method,headers:{
        ...(cookie?{cookie}:{}),
        ...(origin?{origin}:{}),
        ...(filename?{"x-filename":encodeURIComponent(filename)}:{}),
        ...(data&&!(data instanceof Uint8Array)?{"content-type":"application/json"}:{})
      },
      ...(data?{body:data instanceof Uint8Array?data:JSON.stringify(data)}:{})
    }
  );
  const raw=Buffer.from("%PDF-1.4\nSynthetic legal test document\n%%EOF\n");
  try{
    await start();
    const opened=await call("/guest");
    const cookie=opened.headers.get("set-cookie").split(";")[0];
    const status=await opened.json();
    assert.equal(status.attachmentLimit,3);
    assert.equal(status.attachmentTotalBytes,1500000);
    assert.deepEqual(status.documents,[]);

    assert.equal((await call("/guest/documents",{
      method:"POST",filename:"case.pdf",data:raw
    })).status,409,"guest cookie is required");
    assert.equal((await call("/guest/documents",{
      cookie,method:"POST",filename:"fake.pdf",data:Buffer.from("not a PDF")
    })).status,400,"file signature is checked");
    assert.equal((await call("/guest/documents",{
      cookie,method:"POST",filename:"case.pdf",data:raw,origin:"https://evil.example"
    })).status,403,"cross-origin upload is refused");
    const uploaded=await call("/guest/documents",{
      cookie,method:"POST",filename:"Тест_02_Смысловой_анализ.pdf",data:raw
    });
    assert.equal(uploaded.status,201);
    const body=await uploaded.json();
    const doc=body.document;
    assert.match(doc.filename,/Смысловой/);
    assert.equal(doc.size,raw.length);
    assert.equal(body.documents.length,1);
    assert.ok(!JSON.stringify(body).includes("Synthetic legal test document"));

    await stop();await start();
    const persisted=await (await call("/guest",{cookie})).json();
    assert.equal(persisted.documents[0].id,doc.id);
    const other=await call("/guest");
    const otherCookie=other.headers.get("set-cookie").split(";")[0];
    const leaked=await call("/guest/chat",{
      cookie:otherCookie,method:"POST",
      data:{message:"Прочитай документ",mode:"consult",docIds:[doc.id]}
    });
    assert.equal(leaked.status,404,"other guest cannot access document");

    const requestId=crypto.randomUUID();
    const chat=await call("/guest/chat",{
      cookie,method:"POST",
      data:{message:"Прочитай все три страницы приложенного файла полностью",
        mode:"consult",docIds:[doc.id],requestId}
    });
    assert.equal(chat.status,200);
    const answered=await chat.json();
    assert.match(answered.messages.at(-1).text,/Прочитано PDF: 1/);
    assert.deepEqual(answered.messages.at(-2).attachments,[doc.filename]);
    assert.equal(answered.tokenBalance,18500);
    const duplicate=await call("/guest/chat",{
      cookie,method:"POST",
      data:{message:"Прочитай все три страницы приложенного файла полностью",
        mode:"consult",docIds:[doc.id],requestId}
    });
    assert.equal((await duplicate.json()).alreadyProcessed,true);
    const changed=await call("/guest/chat",{
      cookie,method:"POST",
      data:{message:"Прочитай все три страницы приложенного файла полностью",
        mode:"consult",docIds:[],requestId}
    });
    assert.equal(changed.status,409,"retry id ties to document IDs");

    const registered=await call("/auth/register",{
      cookie,method:"POST",data:{
        email:"legal-test@example.kz",password:"long-test-password",invite:"test-code"
      }
    });
    assert.equal(registered.status,201);
    const newSession=registered.headers.get("set-cookie").split(";")[0];
    const registration=await (await call("/cases",{cookie:newSession})).json();
    assert.equal(registration.cases.length,1);
    const caseId=registration.cases[0].id;
    const caseData=await (await call("/cases/"+caseId,{cookie:newSession})).json();
    assert.equal(caseData.documents.length,1);
    assert.equal(caseData.documents[0].id,doc.id);
    assert.equal(caseData.messages.length,2);
    const continued=await call("/cases/"+caseId+"/chat",{
      cookie:newSession,method:"POST",
      data:{message:"Продолжи анализ файла",mode:"consult",docIds:[doc.id],
        requestId:crypto.randomUUID()}
    });
    assert.equal(continued.status,200);
    const result=await continued.json();
    assert.match(result.answer,/Прочитано PDF: 1/);
  }finally{
    await stop();fs.rmSync(temp,{recursive:true,force:true});
  }
});
