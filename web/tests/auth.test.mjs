import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  newEmailCode,emailCodeHash,emailCodeMatches,googleStart,verifyGoogleCookie,clearGoogleCookie
} from "../auth.mjs";

test("email verification codes require exact six digits, are hashed and expire in application layer",()=>{
  const email="person@example.kz",key=crypto.randomBytes(32);
  const code=newEmailCode(),hash=emailCodeHash(email,code,key);
  assert.match(code,/^\d{6}$/);
  assert.equal(emailCodeMatches(email,code,hash,key),true);
  assert.equal(emailCodeMatches(email,"123",hash,key),false);
  assert.equal(emailCodeMatches("other@example.kz",code,hash,key),false);
  assert.equal(emailCodeMatches(email,"000000",hash,key),code==="000000");
});
test("Google OAuth state is MAC-protected and bound to a time window",()=>{
  const priorId=process.env.GOOGLE_CLIENT_ID;
  const priorSecret=process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID="test-client-id";
  process.env.GOOGLE_CLIENT_SECRET="test-secret";
  try{
    const key=crypto.randomBytes(32);
    const flow=googleStart({origin:"https://ailawyer.kz",key,remember:true});
    const url=new URL(flow.url);
    assert.equal(url.origin,"https://accounts.google.com");
    assert.equal(url.searchParams.get("scope"),"openid email");
    assert.equal(url.searchParams.get("redirect_uri"),"https://ailawyer.kz/chat/auth/google/callback");
    assert.equal(url.searchParams.get("code_challenge_method"),"S256");
    const cookieValue=flow.cookie.match(/^al_google_state=([^;]+)/)[1];
    const data=verifyGoogleCookie(cookieValue,key);
    assert.equal(data.remember,true);
    assert.equal(data.state,url.searchParams.get("state"));
    assert.throws(()=>verifyGoogleCookie(cookieValue,crypto.randomBytes(32)),/Invalid OAuth state/);
    const corrupted=cookieValue.slice(0,-1)+(cookieValue.at(-1)==="a"?"b":"a");
    assert.throws(()=>verifyGoogleCookie(corrupted,key),/Invalid OAuth state/);
    assert.match(clearGoogleCookie(true),/Max-Age=0/);
  }finally{
    if(priorId===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=priorId;
    if(priorSecret===undefined)delete process.env.GOOGLE_CLIENT_SECRET;else process.env.GOOGLE_CLIENT_SECRET=priorSecret;
  }
});
