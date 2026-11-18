// Internal service tokens are NOT provider API tokens. Values below are stored
// as legacy credits, each worth exactly 100 public tokens, for backwards
// compatibility with encrypted balances and referral campaigns.
import crypto from "node:crypto";

// Public display unit: 100 AI Lawyer tokens = 1 legacy prepaid service credit.
// Existing encrypted balances are NOT multiplied in storage or re-granted.
export const PUBLIC_TOKEN_MULTIPLIER=100;
export function displayTokens(legacyCredits) {
  return legacyCredits===null || legacyCredits===undefined ? null
    : legacyCredits*PUBLIC_TOKEN_MULTIPLIER;
}

export const REFERRAL_BONUS=50; // 5,000 extra tokens via a valid referral.
export const TRIAL_CREDITS=200; // 20,000 tokens after verified signup.
export const GUEST_PUBLIC_TOKENS=20000; // One shared welcome budget.
export const GUEST_CONSULT_COST=1500; // Ten consultations cost 15,000 total.
export const GUEST_DOCUMENT_COST=5000; // One document costs 5,000 total.
export const PACKAGES=Object.freeze([
  Object.freeze({id:"try",name:"Пробный",tokens:10000,priceKzt:990}),
  Object.freeze({id:"start",name:"Старт",tokens:25000,priceKzt:1990}),
  Object.freeze({id:"plus",name:"Плюс",tokens:45000,priceKzt:2990}),
  Object.freeze({id:"work",name:"Практика",tokens:90000,priceKzt:4990}),
  Object.freeze({id:"pro",name:"Профессиональный",tokens:200000,priceKzt:9990})
]);
export const MODE_COSTS=Object.freeze({
  consult:15,audit:80,strategy:120,draft:50,review:120,compact:30
});
export function aiTokenCost(mode,documentCount=0) {
  if(mode==="consult")return documentCount?45+Math.max(0,documentCount-1)*15:15;
  return MODE_COSTS[mode]||15;
}
export function remainingGuestTokens(guest) {
  if(!guest)return 0;
  // Preserve spent amounts from the previous guest layout. Both old and new
  // guest sessions use 'used' and 'draftUsed'; no separate balance to reset.
  const consults=Math.max(0,Math.min(10,Number(guest.used)||0));
  const drafts=guest.draftUsed===true?1:0;
  return Math.max(0,GUEST_PUBLIC_TOKENS-
    consults*GUEST_CONSULT_COST-drafts*GUEST_DOCUMENT_COST);
}
export function normalizeReferral(raw) {
  const code=String(raw??"").trim().toUpperCase();
  if(!code)return "";
  return /^[A-Z0-9]{8,20}$/.test(code)?code:null;
}
export function safeSource(raw) {
  return String(raw??"").replace(/[^a-zA-Z0-9_.-]/g,"").slice(0,60);
}
export function campaignByCode(db,raw) {
  const code=normalizeReferral(raw);
  return code&&(db.referrals||[]).find(x=>x.code===code&&x.active===true&&
    x.redemptions<x.maxRedemptions)||null;
}
export function createCampaign(db,{partner,maxRedemptions=5}) {
  const name=String(partner||"").trim();
  if(name.length<2||name.length>70)throw Error("Укажите название рекламного партнёра (2–70 символов)");
  if(!Number.isInteger(maxRedemptions)||maxRedemptions<1||maxRedemptions>1000)
    throw Error("Лимит подтверждённых регистраций должен быть от 1 до 1000");
  db.referrals??=[];
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code=Array.from(crypto.randomBytes(12),b=>alphabet[b%alphabet.length]).join("");
  }while(db.referrals.some(x=>x.code===code));
  const c={code,partner:name,active:true,credits:REFERRAL_BONUS,
    maxRedemptions,redemptions:0,createdAt:new Date().toISOString()};
  db.referrals.push(c);
  return c;
}
export function registrationCredit(db,raw) {
  if(raw){
    const campaign=campaignByCode(db,raw);
    if(!campaign)throw Error("Партнёрская ссылка недействительна или лимит регистраций исчерпан");
    return {credits:TRIAL_CREDITS+REFERRAL_BONUS,referralCode:campaign.code,partner:campaign.partner};
  }
  return {credits:TRIAL_CREDITS,referralCode:null,partner:null};
}
export function allocateVerifiedRegistration(db,raw) {
  const grant=registrationCredit(db,raw);
  if(grant.referralCode){
    const campaign=campaignByCode(db,grant.referralCode);
    if(!campaign)throw Error("Партнёрская ссылка больше недействительна");
    campaign.redemptions++;
  }
  return grant;
}
export function balanceOf(user) {
  return Number.isInteger(user?.credits)&&user.credits>=0?user.credits:null;
}
export function canSpend(user,cost) {
  const balance=balanceOf(user);
  return balance===null || balance>=cost;
}
export function spendCredits(user,cost){
  const balance=balanceOf(user);
  if(balance===null)return;
  if(balance<cost)throw Error("Недостаточно AI-токенов");
  user.credits=balance-cost;
}
export function adminAuthorized(remoteAddress,provided,secret) {
  if(!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(remoteAddress))return false;
  if(!/^[a-f0-9]{64}$/i.test(String(secret||"")) ||
     !/^[a-f0-9]{64}$/i.test(String(provided||"")))return false;
  const a=Buffer.from(secret,"hex"),b=Buffer.from(provided,"hex");
  return crypto.timingSafeEqual(a,b);
}
