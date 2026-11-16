import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  REFERRAL_BONUS,TRIAL_CREDITS,normalizeReferral,safeSource,createCampaign,
  registrationCredit,allocateVerifiedRegistration,campaignByCode,
  aiTokenCost,balanceOf,canSpend,spendCredits,adminAuthorized
} from "../referrals.mjs";

test("partner referral codes are validated, bounded and cannot be self-invented",()=>{
  const db={referrals:[]};
  const campaign=createCampaign(db,{partner:"Рекламщик Алматы",maxRedemptions:2});
  assert.match(campaign.code,/^[A-Z0-9]{12}$/);
  assert.equal(normalizeReferral(campaign.code.toLowerCase()),campaign.code);
  assert.equal(normalizeReferral(""),"");
  assert.equal(normalizeReferral("BAD!"),null);
  assert.equal(safeSource("telegram clicks / partner2026"),"telegramclickspartner2026");
  assert.equal(campaignByCode(db,"FAKEFAKEFAKE"),null);
  assert.equal(registrationCredit(db,"").credits,TRIAL_CREDITS);
  assert.throws(()=>registrationCredit(db,"FAKEFAKEFAKE"),/недействительна/);
  assert.equal(registrationCredit(db,campaign.code).credits,REFERRAL_BONUS);
  assert.equal(db.referrals[0].redemptions,0,"no credit or referral redemption before email verification");
  const first=allocateVerifiedRegistration(db,campaign.code);
  assert.equal(first.credits,50);
  assert.equal(first.referralCode,campaign.code);
  assert.equal(db.referrals[0].redemptions,1);
  const second=allocateVerifiedRegistration(db,campaign.code);
  assert.equal(second.credits,50);
  assert.equal(db.referrals[0].redemptions,2);
  assert.throws(()=>allocateVerifiedRegistration(db,campaign.code),/недействительна/);
  db.referrals[0].active=false;
  assert.equal(campaignByCode(db,campaign.code),null);
});
test("AI-tokens are internal credits with distinct prices for legal operations",()=>{
  assert.equal(aiTokenCost("consult"),1);
  assert.equal(aiTokenCost("consult",1),3);
  assert.equal(aiTokenCost("audit",3),6);
  assert.equal(aiTokenCost("strategy"),8);
  assert.equal(aiTokenCost("draft"),6);
  assert.equal(aiTokenCost("review"),8);
  assert.equal(aiTokenCost("compact"),2);
  const u={credits:50};
  assert.equal(balanceOf(u),50);
  assert.equal(canSpend(u,8),true);
  spendCredits(u,8);
  assert.equal(balanceOf(u),42);
  assert.equal(canSpend(u,45),false);
  assert.throws(()=>spendCredits(u,45),/Недостаточно/);
  assert.equal(balanceOf({}),null,"old pilot accounts retain backward compatibility");
});
test("admin-only referral creation requires localhost and unpredictable secret",()=>{
  const secret=crypto.randomBytes(32).toString("hex");
  assert.equal(adminAuthorized("127.0.0.1",secret,secret),true);
  assert.equal(adminAuthorized("::1",secret,secret),true);
  assert.equal(adminAuthorized("1.2.3.4",secret,secret),false);
  assert.equal(adminAuthorized("127.0.0.1",crypto.randomBytes(32).toString("hex"),secret),false);
  assert.equal(adminAuthorized("127.0.0.1","",secret),false);
  assert.throws(()=>createCampaign({referrals:[]},{partner:"X",maxRedemptions:9000}),/название|Лимит/);
});
