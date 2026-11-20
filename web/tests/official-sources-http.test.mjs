import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";
import {fileURLToPath} from "node:url";

test("public legislation API exposes reviewed source pointers without claiming verified statutes",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"al-legal-sources-http-"));
  const port=30000+Math.floor(Math.random()*12000);
  const base="http://127.0.0.1:"+port+"/chat/api";
  const env={...process.env,PORT:String(port),HOST:"127.0.0.1",DATA_DIR:dir,
    DATA_KEY:crypto.randomBytes(32).toString("hex"),ENABLE_LAW_SEARCH:"0",OPENAI_API_KEY:""};
  const server=fileURLToPath(new URL("../server.mjs",import.meta.url));
  const child=spawn(process.execPath,[server],{env,stdio:["ignore","pipe","inherit"]});
  try {
    let ready=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw Error("Server exited before health");
      try {if((await fetch(base+"/legal/status")).ok){ready=true;break;}}catch{}
      await sleep(70);
    }
    assert.equal(ready,true);
    const status=await (await fetch(base+"/legal/status")).json();
    assert.equal(status.ready,false,"empty legal article corpus must remain unverified");
    assert.equal(status.passages,0);
    assert.equal(status.cataloguedActs,29);
    assert.equal(status.catalogOnly,true);
    const all=await (await fetch(base+"/legal/sources")).json();
    assert.equal(all.sources.length,29);
    assert.equal(all.verifiedArticles,0);
    assert.ok(all.sources.every(x=>x.reviewState==="catalogue_only"));
    const q=await (await fetch(base+"/legal/sources?q="+encodeURIComponent("ЧСИ арест"))).json();
    assert.ok(q.sources.some(x=>x.id==="enforcement"));
    assert.ok(q.sources.every(x=>x.officialUrl.startsWith("https://adilet.zan.kz/rus/docs/")));
    const bank=await (await fetch(base+"/legal/sources?q="+encodeURIComponent("Банковский договор 2024"))).json();
    assert.ok(bank.sources.some(x=>x.id==="bank-law-1995"));
    const not=await (await fetch(base+"/legal/sources?q="+encodeURIComponent("Покупка продуктов"))).json();
    assert.equal(not.count,0);
    assert.ok(!all.sources.some(x=>"text" in x||"article" in x),
      "the catalogue must not claim to contain text of a statute");
  }finally{
    const exit=child.exitCode===null?new Promise(resolve=>child.once("exit",resolve)):null;
    if(exit){child.kill();await exit;}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
