import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {selectLegalPlaybooks,PLAYBOOK_DOMAINS} from "../strategy/playbook-selector.mjs";

const source=fs.readFileSync(fileURLToPath(new URL("../strategy/LEGAL_PLAYBOOKS_V1.md",import.meta.url)),"utf8");

test("legal playbook selection keeps core, focuses on matched specialties and saves prompt tokens",()=>{
  const auto=selectLegalPlaybooks(source,
    "Проверь договор микрокредита и реализацию заложенного автомобиля");
  assert.match(auto,/## Кредиты и МФО/);
  assert.match(auto,/## Автозалог и реализация имущества/);
  assert.match(auto,/## Универсальные требования к живому ответу/);
  assert.match(auto,/## Документы и стиль/);
  assert.doesNotMatch(auto,/## КоАП \/ административные штрафы/);
  assert.ok(auto.length<source.length*0.75,"the specialized instruction must omit unrelated legal branches");
  const bailiff=selectLegalPlaybooks(source,
    "ЧСИ арестовал счет после исполнительной надписи нотариуса");
  assert.match(bailiff,/## Исполнительное производство \/ ЧСИ/);
  assert.match(bailiff,/## Исполнительная надпись нотариуса/);
  assert.doesNotMatch(bailiff,/## Автозалог и реализация имущества/);
  assert.equal(PLAYBOOK_DOMAINS.length,11);
});
test("unclear topic keeps full legal methodology, never loses rules when no specialty matched",()=>{
  assert.equal(selectLegalPlaybooks(source,"Объясни следующий документ"),source);
  assert.equal(selectLegalPlaybooks(source,""),source);
  assert.match(selectLegalPlaybooks(source,"Проверь жалобу на госорган"),
    /## Жалобы в государственные органы \/ АППК/);
  assert.match(selectLegalPlaybooks(source,"Что делать с квитанцией КСК"),
    /## Коммунальные платежи и МЖД/);
});
