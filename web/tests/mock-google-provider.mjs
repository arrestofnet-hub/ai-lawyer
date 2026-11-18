import {generateKeyPair,exportJWK,SignJWT} from "jose";

const {publicKey,privateKey}=await generateKeyPair("RS256");
const jwk={...await exportJWK(publicKey),kid:"test-google-kid",use:"sig",alg:"RS256"};
globalThis.fetch=async(url,options={})=>{
  const target=String(url);
  if(target==="https://api.openai.com/v1/responses")
    return Response.json({output:[{type:"message",content:[{type:"output_text",text:"Тестовый юридический ответ"}]}]});
  if(target==="https://www.googleapis.com/oauth2/v3/certs"){
    if(typeof options?.dispatcher?.dispatch!=="function")throw Error("Missing Google IPv4 dispatcher");
    return Response.json({keys:[jwk]});
  }
  if(target==="https://oauth2.googleapis.com/token"){
    if(typeof options?.dispatcher?.dispatch!=="function")throw Error("Missing Google IPv4 dispatcher");
    const form=new URLSearchParams(options.body);
    if(form.get("client_secret")!==process.env.GOOGLE_CLIENT_SECRET)
      throw Error("Wrong test secret");
    if(form.get("code")==="fail-network"){
      const err=new TypeError("fetch failed");err.cause=Object.assign(new Error("connect"),{code:"ETIMEDOUT"});
      throw err;
    }
    const jwt=await new SignJWT({
      nonce:form.get("code"),sub:process.env.GOOGLE_TEST_SUB||"test-google-sub",
      email:process.env.GOOGLE_TEST_EMAIL||"google-test@example.kz",email_verified:true
    }).setProtectedHeader({alg:"RS256",kid:"test-google-kid"})
      .setIssuer("https://accounts.google.com")
      .setAudience(process.env.GOOGLE_CLIENT_ID)
      .setIssuedAt().setExpirationTime("5m").sign(privateKey);
    return Response.json({id_token:jwt,token_type:"Bearer"});
  }
  throw Error("Unexpected external request: "+target.slice(0,100));
};
