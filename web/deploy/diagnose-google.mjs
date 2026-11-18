#!/usr/bin/env node
// Read-only Google networking diagnostic. Uses NO Google OAuth credentials,
// issues NO access tokens, and prints no response body or sensitive data.
import { Agent, ProxyAgent } from "undici";

const ipv4=new Agent({connect:{family:4,timeout:10000},connections:2});
const specialized=process.env.GOOGLE_HTTPS_PROXY
  ? new ProxyAgent(process.env.GOOGLE_HTTPS_PROXY) : ipv4;
const diagnosticBody=()=>new URLSearchParams({
  grant_type:"authorization_code",code:"invalid-network-diagnostic",
  client_id:"invalid-test-only",code_verifier:"invalid"
});
const checks=[
  {label:"google_certificates_ipv4",url:"https://www.googleapis.com/oauth2/v3/certs",method:"GET",dispatcher:specialized},
  {label:"google_token_default",url:"https://oauth2.googleapis.com/token",method:"POST"},
  {label:"google_token_ipv4",url:"https://oauth2.googleapis.com/token",method:"POST",dispatcher:specialized}
];
const outcome=await Promise.all(checks.map(async c=>{
  const start=Date.now();
  try {
    const response=await fetch(c.url,{
      method:c.method,
      ...(c.method==="POST"?{headers:{"content-type":"application/x-www-form-urlencoded"},
        body:diagnosticBody()}:{}),
      ...(c.dispatcher?{dispatcher:c.dispatcher}:{}),
      signal:AbortSignal.timeout(12000)
    });
    try{await response.body?.cancel();}catch{}
    return {check:c.label,reachable:response.status>=200&&response.status<500,
      status:response.status,ms:Date.now()-start};
  }catch(e){
    const code=String(e?.cause?.code||e?.code||e?.name||"NETWORK_ERROR");
    return {check:c.label,reachable:false,
      error:/^[A-Za-z0-9_]{2,60}$/.test(code)?code:"NETWORK_ERROR",
      ms:Date.now()-start};
  }
}));
for(const x of outcome)console.log(JSON.stringify(x));
if(!outcome.find(x=>x.check==="google_token_ipv4")?.reachable){
  console.log("TOKEN_ENDPOINT_UNREACHABLE: check VPS firewall/provider routing or HTTPS proxy; OAuth code exchange cannot succeed yet.");
  process.exitCode=1;
}else{
  console.log("GOOGLE_NETWORK_OK: POST /token reached Google (HTTP 400 with dummy credentials is expected).");
}
await Promise.allSettled([...new Set([ipv4,specialized])].map(x=>x.close()));
