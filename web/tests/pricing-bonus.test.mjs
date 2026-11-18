import test from "node:test";
import assert from "node:assert/strict";
import {RATES,estimateProviderCost,sumEstimatedProviderCost} from "../pricing.mjs";
import {GUEST_PUBLIC_TOKENS,GUEST_CONSULT_COST,GUEST_DOCUMENT_COST,
  PACKAGES,TRIAL_CREDITS,remainingGuestTokens,displayTokens} from "../referrals.mjs";

test("pricing defines 20k guest, 20k registration, 100k/500k/1m purchasable offer labels",()=>{
  assert.equal(GUEST_PUBLIC_TOKENS,20000);
  assert.equal(GUEST_CONSULT_COST*10+GUEST_DOCUMENT_COST,20000);
  assert.equal(TRIAL_CREDITS*100,20000);
  assert.deepEqual(PACKAGES.map(x=>x.tokens),[100000,500000,1000000]);
  assert.deepEqual(PACKAGES.map(x=>x.priceKzt),[19900,94900,179900]);
  assert.equal(remainingGuestTokens({used:0,draftUsed:false}),20000);
  assert.equal(remainingGuestTokens({used:5,draftUsed:false}),12500);
  assert.equal(remainingGuestTokens({used:5,draftUsed:true}),7500);
  assert.equal(remainingGuestTokens({used:10,draftUsed:true}),0);
  assert.equal(remainingGuestTokens({used:10,draftUsed:false}),5000);
  assert.equal(displayTokens(200),20000);
});

test("cost estimator uses provider input/output counts, cached input, and paid web search calls",()=>{
  assert.equal(RATES["gpt-6-astra"].output,50);
  assert.equal(RATES["gpt-6.1-sol"].output,10);
  const usage={input_tokens:8000,output_tokens:3000,input_tokens_details:{cached_tokens:1000}};
  const astra=estimateProviderCost("gpt-6-astra",usage,1);
  assert.ok(Math.abs(astra.estimatedUsd-0.231)<0.00001);
  const sol=estimateProviderCost("gpt-6.1-sol",usage,1);
  assert.ok(Math.abs(sol.estimatedUsd-0.0541)<0.00001);
  assert.equal(estimateProviderCost("unknown",usage,0),null);
  assert.equal(estimateProviderCost("gpt-6-astra",null,0),null);
  assert.ok(Math.abs(sumEstimatedProviderCost([
    {...astra,free:false},{...sol,free:true}
  ],true)-0.0541)<0.00001);
});
