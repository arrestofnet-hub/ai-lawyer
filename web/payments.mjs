// Provider-neutral order ledger. No public settlement route: the future provider
// adapter must independently authenticate and verify a final captured payment.
import {randomUUID} from "node:crypto";
import {PACKAGES,PUBLIC_TOKEN_MULTIPLIER,balanceOf} from "./referrals.mjs";

const PROVIDERS=new Set(["bcc","freedom","kaspi","halyk"]);
function reject(message){throw new Error(message);}
function orders(store){return store.db.paymentOrders||[];}
function validRef(value){return typeof value==="string"&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);}
export function publicOrder(o){
  return {id:o.id,packageId:o.packageId,packageName:o.packageName,tokens:o.tokens,
    priceKzt:o.amountMinor/100,currency:o.currency,provider:o.provider,status:o.status,
    createdAt:o.createdAt,paidAt:o.paidAt||null};
}
export function listOrders(store,userId){
  return orders(store).filter(o=>o.userId===userId).slice().reverse().slice(0,100).map(publicOrder);
}
export function createOrder(store,{userId,packageId,provider,requestId}){
  const user=store.db.users.find(u=>u.id===userId);
  if(!user||balanceOf(user)===null||!["trial","paid"].includes(user.accountType))reject("Invalid account");
  if(!PROVIDERS.has(provider)||!validRef(requestId))reject("Invalid provider or request ID");
  const existing=orders(store).find(o=>o.userId===userId&&o.requestId===requestId);
  if(existing){
    if(existing.packageId!==packageId||existing.provider!==provider)reject("Request ID conflict");
    return publicOrder(existing);
  }
  const pkg=PACKAGES.find(p=>p.id===packageId);
  if(!pkg||!Number.isSafeInteger(pkg.priceKzt*100)||!Number.isSafeInteger(pkg.tokens/PUBLIC_TOKEN_MULTIPLIER))reject("Invalid package");
  const o={id:randomUUID(),userId,requestId,packageId:pkg.id,packageName:pkg.name,
    provider,amountMinor:pkg.priceKzt*100,currency:"KZT",tokens:pkg.tokens,
    credits:pkg.tokens/PUBLIC_TOKEN_MULTIPLIER,status:"pending",createdAt:new Date().toISOString()};
  const previous=store.db.paymentOrders;
  store.db.paymentOrders=[...orders(store),o];
  try{store.save();}catch(e){
    if(previous===undefined)delete store.db.paymentOrders;else store.db.paymentOrders=previous;
    throw e;
  }
  return publicOrder(o);
}
// Internal only. verifiedPayment is a normalized, authenticated provider result,
// never a raw callback, browser redirect, customer receipt or client JSON.
export function settleVerifiedPayment(store,verifiedPayment){
  const {orderId,provider,transactionId,amountMinor,currency,status}=verifiedPayment||{};
  const o=orders(store).find(x=>x.id===orderId);
  if(!o||o.provider!==provider||!validRef(transactionId)||status!=="captured"||
     currency!==o.currency||!Number.isSafeInteger(amountMinor)||amountMinor!==o.amountMinor)
    reject("Payment verification mismatch");
  if(orders(store).some(x=>x!==o&&x.provider===provider&&x.transactionId===transactionId))
    reject("Transaction already used");
  if(o.status==="paid"){
    if(o.transactionId!==transactionId)reject("Order already paid by another transaction");
    return {credited:false,order:publicOrder(o)};
  }
  if(o.status!=="pending")reject("Invalid order state");
  const user=store.db.users.find(u=>u.id===o.userId);
  if(!user||balanceOf(user)===null||!["trial","paid"].includes(user.accountType)||
     !Number.isSafeInteger(user.credits+o.credits))reject("Invalid account balance");
  const previous={...o},credits=user.credits,accountType=user.accountType;
  o.status="paid";o.transactionId=transactionId;o.paidAt=new Date().toISOString();
  user.credits+=o.credits;user.accountType="paid";
  try{store.save();}catch(e){
    for(const key of Object.keys(o))delete o[key];
    Object.assign(o,previous);user.credits=credits;user.accountType=accountType;throw e;
  }
  return {credited:true,order:publicOrder(o)};
}
