import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { createRemoteJWKSet, jwtVerify } from "jose";

const OAUTH_COOKIE="al_google_state";
const jwks=createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const b64=value=>Buffer.from(value).toString("base64url");
const hmac=(data,key)=>crypto.createHmac("sha256",key).update(data).digest("base64url");
export const redirectUri=origin=>origin+"/chat/auth/google/callback";
export const mailEnabled=()=>!!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
export const googleEnabled=()=>!!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function signedGoogleCookie(payload,key,secure) {
  const data=b64(JSON.stringify(payload));
  const signature=hmac(data,key);
  return OAUTH_COOKIE+"="+data+"."+signature+"; HttpOnly; SameSite=Lax; Path=/chat/auth/google/; Max-Age=600"+(secure?"; Secure":"");
}
export function clearGoogleCookie(secure) {
  return OAUTH_COOKIE+"=; HttpOnly; SameSite=Lax; Path=/chat/auth/google/; Max-Age=0"+(secure?"; Secure":"");
}
export function verifyGoogleCookie(raw,key) {
  if(typeof raw!=="string"||raw.length>2000)throw Error("Invalid OAuth state");
  const [data,mac,extra]=raw.split(".");
  if(!data||!mac||extra)throw Error("Invalid OAuth state");
  const a=Buffer.from(hmac(data,key)), b=Buffer.from(mac);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Error("Invalid OAuth state");
  const payload=JSON.parse(Buffer.from(data,"base64url").toString("utf8"));
  if(!payload||typeof payload.state!=="string"||typeof payload.nonce!=="string"||
     typeof payload.verifier!=="string"||typeof payload.issued!=="number"||
     Date.now()-payload.issued>600000||payload.issued>Date.now()+30000)
    throw Error("Expired OAuth state");
  return payload;
}
export function googleStart({origin,key,remember,linkUserId=null,linkSessionHash=null,referralCode="",referralSource=""}) {
  if(!googleEnabled())throw Error("Google OAuth is not configured");
  const state=crypto.randomBytes(24).toString("base64url");
  const nonce=crypto.randomBytes(24).toString("base64url");
  const verifier=crypto.randomBytes(48).toString("base64url");
  const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
  const payload={state,nonce,verifier,issued:Date.now(),remember:!!remember,linkUserId,linkSessionHash,referralCode,referralSource};
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for(const [k,v] of Object.entries({
    client_id:process.env.GOOGLE_CLIENT_ID,
    redirect_uri:redirectUri(origin),response_type:"code",
    scope:"openid email",state,nonce,
    code_challenge:challenge,code_challenge_method:"S256",
    prompt:"select_account",
  }))url.searchParams.set(k,v);
  return {url:url.toString(),cookie:signedGoogleCookie(payload,key,origin.startsWith("https:"))};
}
export async function googleIdentity(code,flow,origin) {
  if(typeof code!=="string"||code.length>4000)throw Error("Invalid authorization code");
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      code,client_id:process.env.GOOGLE_CLIENT_ID,
      client_secret:process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:redirectUri(origin),grant_type:"authorization_code",
      code_verifier:flow.verifier,
    }),signal:AbortSignal.timeout(20000)
  });
  if(!response.ok)throw Error("Google authorization failed");
  const data=await response.json();
  if(typeof data.id_token!=="string")throw Error("No ID token");
  const {payload}=await jwtVerify(data.id_token,jwks,{
    issuer:["https://accounts.google.com","accounts.google.com"],
    audience:process.env.GOOGLE_CLIENT_ID,
    clockTolerance:15,
  });
  if(payload.nonce!==flow.nonce||typeof payload.sub!=="string"||
     payload.email_verified!==true||typeof payload.email!=="string")
    throw Error("Google identity invalid");
  return {sub:payload.sub,email:payload.email.trim().toLowerCase()};
}
export function newEmailCode() {
  return String(crypto.randomInt(0,1000000)).padStart(6,"0");
}
export function emailCodeHash(email,code,key) {
  return crypto.createHmac("sha256",key).update(email+"|"+code).digest("hex");
}
export function emailCodeMatches(email,code,hash,key) {
  if(!/^\d{6}$/.test(String(code||"")))return false;
  const a=Buffer.from(emailCodeHash(email,code,key)),b=Buffer.from(hash||"");
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export async function sendVerificationCode(email,code) {
  if(!mailEnabled())throw Error("Email delivery not configured");
  const transport=nodemailer.createTransport({
    host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),
    secure:String(process.env.SMTP_PORT)==="465",
    requireTLS:String(process.env.SMTP_PORT)!=="465",
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},
  });
  try {
    await transport.sendMail({
      from:process.env.SMTP_FROM,to:email,
      subject:"AI Lawyer Kazakhstan — подтверждение email",
      text:"Код подтверждения регистрации: "+code+"\n\nСрок действия — 15 минут. Если это не вы, проигнорируйте письмо.",
    });
  } finally { transport.close(); }
}
