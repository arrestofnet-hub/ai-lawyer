import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("legal evaluation suite covers core risk patterns without client identifiers",()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const e=JSON.parse(fs.readFileSync(path.join(here,"..","evals","legal-scenarios.json"),"utf8"));
  assert.ok(e.cases.length>=15);
  const ids=new Set();
  const modes=new Set(["consult","audit","strategy","draft","review"]);
  for(const x of e.cases){
    assert.equal(typeof x.id,"string");assert.ok(!ids.has(x.id));ids.add(x.id);
    assert.ok(modes.has(x.mode));
    assert.ok(x.prompt.length>35);
    assert.ok(x.required.length>=2);
    assert.ok(x.forbidden.length>=1);
  }
});
