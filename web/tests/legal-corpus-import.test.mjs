import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const cli=fileURLToPath(new URL("../deploy/import-legal-corpus.mjs",import.meta.url));
const example={
  id:"test-only-entry",actTitle:"Учебный акт для тестов, не действующий закон",
  article:"Пункт 1",text:"Это синтетический фрагмент тестового правового акта, без юридической силы.",
  lang:"ru",sourceUrl:"https://adilet.zan.kz/rus/docs/TEST-ONLY",
  editionDate:"2026-10-01",checkedAt:"2026-11-01",
  effectiveFrom:"2026-10-01",effectiveTo:null,status:"official"
};

test("reviewed legal corpus import is dry-run safe, atomic, backed up, and rejects empty overwrite",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"al-legal-import-"));
  const source=path.join(dir,"incoming.json");
  const target=path.join(dir,"private","legal-corpus.json");
  const env={...process.env,DATA_DIR:path.join(dir,"private"),LEGAL_CORPUS_FILE:target};
  const run=(...args)=>spawnSync(process.execPath,[cli,source,...args],{encoding:"utf8",env});
  try{
    fs.writeFileSync(source,JSON.stringify([example]));
    const preview=run("--check-only");
    assert.equal(preview.status,0,preview.stderr);
    assert.equal(fs.existsSync(target),false,"check only never modifies active corpus");
    const imported=run();
    assert.equal(imported.status,0,imported.stderr);
    assert.equal(JSON.parse(fs.readFileSync(target,"utf8")).length,1);
    const replacement={...example,id:"second-valid-entry",article:"Пункт 2"};
    fs.writeFileSync(source,JSON.stringify([replacement]));
    const updated=run();
    assert.equal(updated.status,0,updated.stderr);
    const backups=fs.readdirSync(path.dirname(target)).filter(s=>s.startsWith("legal-corpus.json.bak-"));
    assert.equal(backups.length,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(target),backups[0]),"utf8"))[0].id,"test-only-entry");
    const before=fs.readFileSync(target,"utf8");
    fs.writeFileSync(source,"[]");
    assert.notEqual(run().status,0);
    assert.equal(fs.readFileSync(target,"utf8"),before,"empty update must not erase law corpus");
    fs.writeFileSync(source,JSON.stringify([{...example,sourceUrl:"https://evil.invalid/docs/test"}]));
    assert.notEqual(run().status,0);
    assert.equal(fs.readFileSync(target,"utf8"),before,"untrusted URLs must not replace law corpus");
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
