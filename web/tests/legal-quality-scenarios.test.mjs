import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {selectLegalPlaybooks,PLAYBOOK_DOMAINS} from "../strategy/playbook-selector.mjs";

const scenarios=JSON.parse(fs.readFileSync(fileURLToPath(new URL("../legal/quality-scenarios.json",import.meta.url)),"utf8"));
const playbooks=fs.readFileSync(fileURLToPath(new URL("../strategy/LEGAL_PLAYBOOKS_V1.md",import.meta.url)),"utf8");

test("ten synthetic legal quality scenarios are private-data-free and have falsifiable review goals",()=>{
  assert.equal(scenarios.length,10);
  for(const s of scenarios){
    assert.match(s.id,/^[a-z-]{5,40}$/);
    assert.ok(s.question.length>20);
    assert.ok(s.expectedNextStep.length>15);
    assert.ok(s.forbiddenInference.length>18);
    assert.ok(s.expectedDomains.every(x=>PLAYBOOK_DOMAINS.includes(x)));
    assert.doesNotMatch(JSON.stringify(s),/\b\d{12}\b/,
      "an actual IIN must not be present in synthetic scenarios");
  }
});
for(const scenario of scenarios){
  test("legal domain: "+scenario.id,()=>{
    const selected=selectLegalPlaybooks(playbooks,scenario.question);
    for(const title of scenario.expectedDomains)
      assert.ok(selected.includes("## "+title),"missing relevant playbook "+title);
    assert.match(selected,/## Универсальные требования к живому ответу/);
    assert.match(selected,/## Документы и стиль/);
    // These structural checks are NOT evidence that the model made a legally
    // correct recommendation. Actual Sol outputs need separate expert review.
  });
}
