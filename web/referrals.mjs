// Internal AI-tokens are prepaid service credits, NOT provider API token units.
// A bonus of 50 AI-tokens corresponds to 50 short consultations; complex modes
// consume more. Campaigns cannot be issued or changed by public users.
import crypto from "node:crypto";

// Public display unit: 100 AI Lawyer tokens = 1 legacy prepaid service credit.
// Existing encrypted balances are NOT multiplied in storage or re-granted.
export const PUBLIC_TOKEN_MULTIPLIER=100;
export function displayTokens(legacyCredits) {
  return legacyCredits===null || legacyCredits===undefined ? null
    : legacyCredits*PUBLIC_TOKEN_MULTIPLIER;
}

export const REFERRAL_BONUS=50;
export const TRIAL_CREDITS=3;
export const MODE_COSTS=Object.freeze({
  consult:1,audit:6,strategy:8,draft:6,review:8,compact:2
});
export function aiTokenCost(mode,documentCount=0) {
  if(mode==="consult")return documentCount?Math.max(3,documentCount*3):1;
  return MODE_COSTS[mode]||1;
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
    return {credits:REFERRAL_BONUS,referralCode:campaign.code,partner:campaign.partner};
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
