#!/usr/bin/env node
// AI Lawyer Kazakhstan: root-only partner campaign administration.
// Does not expose internal API secrets or edit encrypted database directly.
// Commands: create <partner-name> [max-redemptions], list, disable <code>
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ENV_FILE="/etc/ai-lawyer-web.env";
const APP_URL="http://127.0.0.1:8791";
if(process.getuid?.()!==0){console.error("Use root SSH terminal.");process.exit(2);}
let envFile;
try{envFile=fs.readFileSync(ENV_FILE,"utf8");}
catch{console.error("Missing private server settings.");process.exit(2);}
const read=key=>envFile.match(new RegExp("^"+key+"=([^\\r\\n]*)","m"))?.[1]?.replace(/^["']|["']$/g,"")||"";
let key=read("REFERRAL_ADMIN_KEY");
if(!/^[a-f0-9]{64}$/.test(key)){
  const backup=ENV_FILE+".referral-setup-"+Date.now();
  key=crypto.randomBytes(32).toString("hex");
  fs.copyFileSync(ENV_FILE,backup);
  try{
    fs.appendFileSync(ENV_FILE,"\nREFERRAL_ADMIN_KEY="+key+"\n",{mode:0o600});
    execFileSync("systemctl",["restart","ai-lawyer-web"],{stdio:"ignore",timeout:20000});
  }catch(e){
    fs.copyFileSync(backup,ENV_FILE);
    try{execFileSync("systemctl",["restart","ai-lawyer-web"],{stdio:"ignore",timeout:20000});}catch{}
    console.error("Could not initialize private referral settings; restored previous configuration.");
    process.exit(1);
  }
  console.log("Initialized private referral administrator key (not displayed).");
}
const [action,arg,limitRaw]=process.argv.slice(2);
async function adminRequest(endpoint,method,body) {
  const response=await fetch(APP_URL+endpoint,{
    method,
    headers:{"content-type":"application/json","x-ai-lawyer-admin-key":key},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(12000)
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw Error("Server rejected admin command ("+response.status+"): "+(json.error||"request failed"));
  return json;
}
try{
  if(action==="create"){
    const partner=(arg||"").trim();
    const maxRedemptions=limitRaw===undefined?5:Number(limitRaw);
    if(partner.length<2||partner.length>70||!Number.isInteger(maxRedemptions)||
      maxRedemptions<1||maxRedemptions>1000)throw Error("Usage: create 'Partner Name' [max 1..1000]");
    const result=await adminRequest("/chat/api/admin/referrals","POST",{partner,maxRedemptions});
    console.log("Partner: "+result.campaign.partner);
    console.log("Promotional credit: 50 AI-tokens per verified registered user.");
    console.log("Max verified registrations: "+result.campaign.maxRedemptions);
    console.log("Referral link: "+result.link);
  }else if(action==="list"){
    const result=await adminRequest("/chat/api/admin/referrals","GET");
    for(const c of result.campaigns)console.log([c.partner,c.code,c.active?"ACTIVE":"DISABLED",
      c.redemptions+"/"+c.maxRedemptions].join(" | "));
    if(!result.campaigns.length)console.log("No referral campaigns created.");
  }else if(action==="disable"){
    if(!/^[A-Z0-9]{8,20}$/.test(arg||""))throw Error("Usage: disable CAMPAIGNCODE");
    const result=await adminRequest("/chat/api/admin/referrals/disable","POST",{code:arg});
    console.log("Campaign disabled: "+result.code+". Existing user credits were not altered.");
  }else throw Error("Usage: node deploy/referral-admin.mjs create 'Partner Name' [max-redemptions] | list | disable CODE");
}catch(e){console.error(e.message);process.exitCode=1;}
