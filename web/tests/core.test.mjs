import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dataKey, encrypt, decrypt, Store, randomId, hashPassword, checkPassword, validateEmail,
  classifyFile, extractOutput, buildMessages, strategyInstruction
} from "../core.mjs";

test("account validation and passwords",()=>{
  assert.equal(validateEmail(" SOMEONE@EXAMPLE.KZ "), "someone@example.kz");
  assert.equal(validateEmail("bad-email"),null);
  const hash=hashPassword("long-secret-password");
  assert.equal(checkPassword("long-secret-password",hash),true);
  assert.equal(checkPassword("not-the-password",hash),false);
});
test("AES-GCM encrypts and detects tampering",()=>{
  const key=dataKey(crypto.randomBytes(32).toString("hex"));
  const ciphertext=encrypt(key,{a:1,text:"дело"});
  assert.deepEqual(JSON.parse(decrypt(key,ciphertext).toString()),{a:1,text:"дело"});
  ciphertext[ciphertext.length-1]^=1;
  assert.throws(()=>decrypt(key,ciphertext));
  assert.throws(()=>dataKey("password"));
});
test("encrypted persistence and owner isolation",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ailawyer-"));
  try {
    const key=dataKey(crypto.randomBytes(32).toString("hex"));
    const s=new Store(root,key), id=randomId();
    s.db.cases.push({id,ownerId:"owner-1",title:"Тест",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    s.save();const s2=new Store(root,key);
    assert.equal(s2.getCase("owner-1",id)?.title,"Тест");
    assert.equal(s2.getCase("owner-2",id),null);
    assert.equal(fs.readFileSync(path.join(root,"database.enc")).includes(Buffer.from("Тест")),false);
    s2.writeFile(id,Buffer.from("secret document"));
    assert.equal(s2.readFile(id).toString(),"secret document");
    s2.deleteFile(id);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("file type checks are strict",()=>{
  assert.equal(classifyFile("letter.pdf",Buffer.from("%PDF-1.7\nhello"))?.type,"application/pdf");
  assert.equal(classifyFile("wrong.pdf",Buffer.from("hello")),null);
  assert.equal(classifyFile("x.exe",Buffer.from("abcdef")),null);
  assert.equal(classifyFile("scan.png",Buffer.from("89504e470d0a1a0a","hex"))?.type,"image/png");
});
test("model output and citations are sourced from annotations",()=>{
  const x=extractOutput({output:[{type:"message",content:[{type:"output_text",text:"Вывод",annotations:[
    {type:"url_citation",url:"https://adilet.zan.kz/rus/docs/",title:"Adilet"},
    {type:"url_citation",url:"javascript:alert(1)",title:"Bad"}]}]}]});
  assert.equal(x.text,"Вывод");assert.equal(x.sources.length,1);
});
test("legal modes preserve case context",()=>{
  const msg=buildMessages([{role:"user",text:"Первый вопрос"}],"Новый факт",[],{title:"Уступка",objective:"Оспорить",summary:"Нет приложения",mode:"audit"});
  assert.equal(msg[0].content.includes("Уступка"),true);
  assert.equal(msg.at(-1).content[0].text,"Новый факт");
  const instr=strategyInstruction("Не выдумывай факты","review");
  assert.match(instr,/Не выдумывай факты/);assert.match(instr,/Пересмотри/);
});
