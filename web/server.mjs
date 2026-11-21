import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { exportDocx, exportPdf } from "./export.mjs";
import {
  REFERRAL_BONUS,TRIAL_CREDITS,aiTokenCost,normalizeReferral,safeSource,
  campaignByCode,createCampaign,registrationCredit,allocateVerifiedRegistration,
  balanceOf,canSpend,spendCredits,adminAuthorized,displayTokens,PUBLIC_TOKEN_MULTIPLIER,
  GUEST_PUBLIC_TOKENS,GUEST_CONSULT_COST,GUEST_DOCUMENT_COST,PACKAGES,remainingGuestTokens
} from "./referrals.mjs";
import {
  googleEnabled, mailEnabled, googleStart, googleIdentity, verifyGoogleCookie, clearGoogleCookie,
  GoogleOAuthError, googleOAuthFailure,
  newEmailCode, emailCodeHash, emailCodeMatches, sendVerificationCode, sendPasswordResetCode
} from "./auth.mjs";
import {
  Store, MAX_FILE_BYTES, MAX_MESSAGE_CHARS, MAX_CASES_PER_USER, MAX_DOCS_PER_CASE,
  validateEmail, validPassword, hashPassword, checkPassword, tokenHash, dataKey,
  randomId, classifyFile, extractOutput, buildMessages, strategyInstruction,
} from "./core.mjs";
import {estimateProviderCost,sumEstimatedProviderCost} from "./pricing.mjs";
import {selectLegalPlaybooks} from "./strategy/playbook-selector.mjs";
import {blankDossier,validateDossier,dossierView,dossierPromptContext} from "./legal/dossier.mjs";
import {loadLegalCorpus,buildLegalContext,legalCorpusStatus} from "./legal/norms.mjs";
import {loadOfficialRegistry,selectOfficialSources,sourcePointerContext,officialSourceStatus}
  from "./legal/sources.mjs";
import {loadArticleSnapshots,retrieveArticleSnapshots,buildArticleSnapshotContext,
  articleSnapshotStatus} from "./legal/snapshots.mjs";
import {getLiveOfficialArticleContext} from "./legal/live-official.mjs";
import {getTimelineOfficialContext} from "./legal/historical.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8791);
const ORIGIN = String(process.env.PUBLIC_ORIGIN || "http://localhost:" + PORT).replace(/\/$/, "");
const KEY = dataKey(process.env.DATA_KEY);
const store = new Store(process.env.DATA_DIR || path.join(dirname, "private-data"), KEY);
const strategy = fs.readFileSync(path.join(dirname, "strategy", "LEGAL_ENGINE_V1.md"), "utf8");
const practiceMethods=fs.readFileSync(path.join(dirname,"strategy","LEGAL_PRACTICE_METHODS_V3.md"),"utf8");
const playbooks = fs.readFileSync(path.join(dirname, "strategy", "LEGAL_PLAYBOOKS_V1.md"), "utf8");
// This empty-by-default corpus can only contain source-dated official legal
// passages; do not invent laws when no reviewed passages have been imported.
const legalPrivateFile=process.env.LEGAL_CORPUS_FILE||
  path.join(store.dir,"legal-corpus.json");
const localNorms=loadLegalCorpus(fs.existsSync(legalPrivateFile)
  ?legalPrivateFile:path.join(dirname,"legal","corpus.json"));
const officialSources=loadOfficialRegistry(path.join(dirname,"legal","official-sources.json"));
const officialArticleSnapshots=loadArticleSnapshots(
  path.join(dirname,"legal","source-snapshots.json"),officialSources);
// Unified Sol model for both free and future paid accounts. An explicit new
// variable controls exceptions; legacy OPENAI_MODEL may still point to Astra
// on older VPS installations, so intentionally do not inherit that setting.
const MODEL = process.env.LAWYER_PRIMARY_MODEL || "gpt-6.1-sol";
const FREE_MODEL = process.env.FREE_TIER_OPENAI_MODEL || MODEL;
const FREE_API_BUDGET_USD=Math.max(1,Math.min(1000,Number(process.env.FREE_API_BUDGET_USD||15)));
const SEARCH_ENABLED = process.env.ENABLE_LAW_SEARCH !== "0";
// Legacy MAX_MESSAGES_PER_DAY is in stored credits (100 public tokens each).
const DAILY_LIMIT = Math.max(200, Number(process.env.MAX_MESSAGES_PER_DAY || 200));
const MAX_USER_DOCS_PER_CHAT = 3;
const GUEST_LIMIT = 10;
const GUEST_REMINDER = 5;
const GUEST_MAX_AGE = 90 * 86400;
const GUEST_ENABLED = process.env.GUEST_CHAT_ENABLED !== "0";
// Conservative pilot caps: model calls are reserved BEFORE calling OpenAI.
// All guest attempts, including upstream failures, count toward these cost guards.
const GUEST_IP_30D_MAX = Math.max(1, Math.min(100, Number(process.env.GUEST_IP_30D_MAX || 12)));
const GUEST_GLOBAL_24H_MAX = Math.max(1, Math.min(10000, Number(process.env.GUEST_GLOBAL_24H_MAX || 40)));
// New Google accounts grant free credits; a separate encrypted, HMAC-keyed
// registration ledger limits cost abuse without storing raw visitor IPs.
const GOOGLE_NEW_IP_30D_MAX = Math.max(1, Math.min(20,Number(process.env.GOOGLE_NEW_IP_30D_MAX || 2)));
const GOOGLE_NEW_GLOBAL_24H_MAX = Math.max(1, Math.min(100,Number(process.env.GOOGLE_NEW_GLOBAL_24H_MAX || 20)));
const DAY_MS = 86400000;
const GUEST_CASE = { title:"Гостевая консультация", objective:"", summary:"" };
const guestRequests = new Set();
const throttle = new Map();
const activeModelRequests=new Set();
const now = () => new Date().toISOString();

const HTML = fs.readFileSync(path.join(dirname, "public", "index.html"));
const JS = fs.readFileSync(path.join(dirname, "public", "app.js"));
const FORMAT_JS = fs.readFileSync(path.join(dirname, "format.mjs"));
const logo = fs.readFileSync(path.join(dirname, "..", "assets", "logo.svg"));

function json(res, status, value, extra = {}) {
  res.writeHead(status, { "content-type":"application/json; charset=utf-8", ...extra });
  res.end(JSON.stringify(value));
}
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && origin !== ORIGIN) fail(403,"Недопустимый источник запроса");
  if (req.headers["sec-fetch-site"] === "cross-site") fail(403,"Недопустимый источник запроса");
}
async function readBody(req, max = MAX_FILE_BYTES + 8192) {
  let length = 0, parts = [];
  for await (const part of req) {
    length += part.length;
    if (length > max) fail(413, "Превышен допустимый размер");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function bodyJson(req, max = 40000) {
  let data;
  try { data = JSON.parse((await readBody(req, max)).toString("utf8")); }
  catch { fail(400, "Некорректный JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Некорректные данные");
  return data;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(s=>s.trim()).filter(s=>s.includes("=")).map(s=>[s.slice(0,s.indexOf("=")),s.slice(s.indexOf("=")+1)]));
}
function sessionFor(req) {
  const raw = cookies(req).al_session;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const hash = tokenHash(raw);
  const s = store.db.sessions.find(x => x.hash === hash && x.expiresAt > Date.now());
  if (!s) return null;
  const user=store.db.users.find(x => x.id === s.userId) || null;
  if(user)grandfatherTrialBalance(user);
  return user;
}
function requireUser(req) { const u = sessionFor(req); if (!u) fail(401,"Требуется вход"); return u; }
function sessionCookie(token, maxAge) {
  const secure = ORIGIN.startsWith("https:") ? "; Secure" : "";
  return `al_session=${token}; HttpOnly; SameSite=Lax; Path=/chat/${Number.isInteger(maxAge)?"; Max-Age="+maxAge:""}${secure}`;
}
function newSession(user,res,remember=false) {
  const days=remember?30:1;
  const token=crypto.randomBytes(32).toString("hex");
  store.db.sessions.push({hash:tokenHash(token),userId:user.id,remember:!!remember,expiresAt:Date.now()+days*86400000});
  store.db.sessions=store.db.sessions.filter(x=>x.expiresAt>Date.now());
  store.save();
  // A persistent 30-day login is issued only after an explicit Remember me choice.
  // Without it this is a browser-session cookie, with a 24-hour server-side expiry.
  res.setHeader("set-cookie",sessionCookie(token,remember?30*86400:undefined));
}
function safeUser(u) { return { id:u.id,email:u.email,googleLinked:!!u.googleSub }; }
function clientIp(req) {
  const remote = req.socket.remoteAddress || "?";
  const forwarded = String(req.headers["x-real-ip"] || "");
  // Only local Nginx is trusted to overwrite X-Real-IP.
  return (["127.0.0.1","::1","::ffff:127.0.0.1"].includes(remote) && net.isIP(forwarded))
    ? forwarded : remote;
}
function rateLimit(req, bucket, limit, ms) {
  const k = bucket + "|" + clientIp(req), entry = throttle.get(k) || { count:0, reset:0 };
  if (entry.reset < Date.now()) { entry.count = 0; entry.reset = Date.now() + ms; }
  entry.count++; throttle.set(k,entry);
  if (entry.count > limit) fail(429,"Слишком много запросов");
  if (throttle.size > 5000) for (const [key,value] of throttle) if (value.reset < Date.now()) throttle.delete(key);
}
function guestQuota(req, at=Date.now()) {
  // HMAC pseudonym: raw IP addresses are NOT stored in the encrypted quota ledger.
  const identity = crypto.createHmac("sha256",KEY).update("guest-ip-v1:" + clientIp(req).toLowerCase()).digest("hex");
  let fromIp = 0, global24h = 0;
  for (const x of (store.db.guestAttempts || [])) {
    if (x.at > at - 30*DAY_MS && x.identity === identity) fromIp++;
    if (x.at > at - DAY_MS) global24h++;
  }
  const ipRemaining = Math.max(0,GUEST_IP_30D_MAX-fromIp);
  const globalRemaining = Math.max(0,GUEST_GLOBAL_24H_MAX-global24h);
  const remaining = Math.min(ipRemaining,globalRemaining);
  const restriction = ipRemaining === 0
    ? "Лимит бесплатных обращений с этого подключения исчерпан. Зарегистрируйтесь или войдите."
    : globalRemaining === 0
    ? "Суточный лимит бесплатных обращений сервиса исчерпан. Зарегистрируйтесь или войдите."
    : null;
  return { identity, remaining, restriction };
}
function enforceFreeApiBudget() {
  if(sumEstimatedProviderCost(store.db.providerUsage,true)>=FREE_API_BUDGET_USD)
    fail(503,"Бесплатный бюджет AI временно исчерпан. Токены не списаны. Обратитесь в поддержку.");
}
function recordProviderUsage(result,user,free) {
  const quote=estimateProviderCost(result.model,result.usage,result.webCalls);
  if(!quote)return;
  (store.db.providerUsage??=[]).push({at:now(),userId:user?.id||null,free:free===true,...quote});
}
function reserveGuestAttempt(req) {
  const at = Date.now(), quota = guestQuota(req,at);
  if (!quota.remaining) fail(429,quota.restriction || "Бесплатный лимит исчерпан");
  const previous = store.db.guestAttempts;
  store.db.guestAttempts = (previous || [])
    .filter(x => Number.isFinite(x.at) && x.at > at-30*DAY_MS)
    .concat({identity:quota.identity,at});
  try { store.save(); }
  catch (error) { store.db.guestAttempts=previous; throw error; }
}
function reserveGoogleSignup(req) {
  const at=Date.now();
  const identity=crypto.createHmac("sha256",KEY)
    .update("google-registration-ip-v1:"+clientIp(req).toLowerCase()).digest("hex");
  const recent=(store.db.googleSignups||[])
    .filter(x=>Number.isFinite(x.at)&&x.at>at-30*DAY_MS);
  const perIp=recent.filter(x=>x.identity===identity).length;
  const global24h=recent.filter(x=>x.at>at-DAY_MS).length;
  if(perIp>=GOOGLE_NEW_IP_30D_MAX || global24h>=GOOGLE_NEW_GLOBAL_24H_MAX)
    throw new GoogleOAuthError("GOOGLE_SIGNUP_LIMIT");
  const previous=store.db.googleSignups;
  store.db.googleSignups=recent.concat({identity,at});
  try{store.save();}
  catch(error){store.db.googleSignups=previous;throw error;}
}
function guestFor(req) {
  const token = cookies(req).al_guest;
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  const hash = tokenHash(token);
  return (store.db.guests || []).find(g => g.hash === hash && g.expiresAt > Date.now()) || null;
}
function guestStatus(guest,req) {
  const used=Math.min(GUEST_LIMIT,guest?.used||0),quota=guestQuota(req);
  const balance=remainingGuestTokens(guest);
  const remaining=Math.min(Math.max(0,GUEST_LIMIT-used),
    Math.floor(balance/GUEST_CONSULT_COST),quota.remaining);
  const documentRemaining=guest?.draftUsed===true||balance<GUEST_DOCUMENT_COST||!quota.remaining?0:1;
  return {used,remaining,limit:GUEST_LIMIT,
    tokenLimit:GUEST_PUBLIC_TOKENS,tokensUsed:GUEST_PUBLIC_TOKENS-balance,
    tokenBalance:balance,tokenCost:GUEST_CONSULT_COST,
    documentTokenCost:GUEST_DOCUMENT_COST,documentRemaining,
    reminderAt:GUEST_REMINDER,
    ...(quota.restriction?{restriction:quota.restriction}:{}),
    messages:guest?.messages.map(m=>store.publicMessage(m))||[]};
}
function openGuest(req,res) {
  const guest = guestFor(req);
  if (guest) return json(res,200,guestStatus(guest,req));
  if (!guestQuota(req).remaining) return json(res,200,guestStatus(null,req));
  rateLimit(req,"guest-start",6,60*60000);
  const token = crypto.randomBytes(32).toString("hex");
  const created = {hash:tokenHash(token),expiresAt:Date.now()+GUEST_MAX_AGE*1000,used:0,draftUsed:false,messages:[]};
  store.db.guests = (store.db.guests || []).filter(g=>g.expiresAt>Date.now());
  store.db.guests.push(created);
  store.save();
  const secure = ORIGIN.startsWith("https:") ? "; Secure" : "";
  return json(res,200,guestStatus(created,req),{
    "set-cookie":`al_guest=${token}; HttpOnly; SameSite=Lax; Path=/chat/; Max-Age=${GUEST_MAX_AGE}${secure}`
  });
}
function ensureGuestIdle(req) {
  if (guestRequests.has(guestFor(req)?.hash))
    fail(409,"Дождитесь ответа на гостевой вопрос и повторите регистрацию");
}
function saveGuestConversation(req,user,priorGuestHash=null,grantRemaining=false) {
  const linked=priorGuestHash
    ? (store.db.guests||[]).find(g=>g.hash===priorGuestHash&&g.expiresAt>Date.now())
    : null;
  const guest=linked||guestFor(req);
  if(!guest||guest.transferredTo)return null;
  if(guestRequests.has(guest.hash))
    fail(409,"Дождитесь окончания гостевого ответа и повторите действие");
  // Only a new verified account receives the remaining 20k guest allowance.
  // Existing-account logins never mint additional credits.
  if(grantRemaining&&user.accountType==="trial"&&Number.isInteger(user.credits))
    user.credits+=Math.floor(remainingGuestTokens(guest)/PUBLIC_TOKEN_MULTIPLIER);
  const id=guest.messages?.length?randomId():null,time=now();
  if(id){
    store.db.cases.push({...GUEST_CASE,id,ownerId:user.id,createdAt:time,updatedAt:time});
    store.db.messages.push(...guest.messages.map(m=>({...m,caseId:id})));
  }
  guest.messages=[];
  guest.transferredTo=user.id;
  return id;
}
function grandfatherTrialBalance(user) {
  // One-time grant to existing verified trial users; preserve older credits.
  if(user?.accountType!=="trial"||user.freeCreditVersion===2||
      !Number.isInteger(user.credits)||user.credits<0)return;
  const previous=user.credits;
  user.credits=previous+TRIAL_CREDITS;
  user.freeCreditVersion=2;
  try{store.save();}
  catch(e){user.credits=previous;delete user.freeCreditVersion;throw e;}
}
async function guestChat(req,res) {
  const body = await bodyJson(req);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) fail(400,"Сообщение пустое или слишком длинное");
  const mode=body.mode === undefined ? "consult" : body.mode;
  if(mode!=="consult" && mode!=="draft")
    fail(400,"Гостям доступны консультация и один документ");
  const requestId=body.requestId===undefined ? null : String(body.requestId);
  if(requestId!==null && !/^[a-f0-9-]{36}$/i.test(requestId))
    fail(400,"Некорректный идентификатор запроса");
  const guest = guestFor(req);
  if (!guest) fail(409,"Обновите страницу, чтобы открыть гостевой чат");
  const already=requestId && guest.messages.find(m=>m.role==="assistant" && m.requestId===requestId);
  if(already){
    const original=guest.messages.find(m=>m.role==="user" && m.requestId===requestId);
    if(!original || original.text!==message || original.mode!==mode)
      fail(409,"Идентификатор запроса уже использован");
    return json(res,200,{...guestStatus(guest,req),alreadyProcessed:true});
  }
  const initialStatus = guestStatus(guest,req);
  const available=mode==="draft" ? initialStatus.documentRemaining : initialStatus.remaining;
  if (!available) return json(res,403,{
    error:initialStatus.restriction || (mode==="draft"
      ? "Бесплатный документ уже подготовлен. Для следующих документов зарегистрируйтесь."
      : "Лимит бесплатных консультаций исчерпан. Перейдите в режим «Документ» или зарегистрируйтесь."),
    guest:initialStatus
  });
  if (guestRequests.has(guest.hash) || guestRequests.size >= 6)
    fail(429,"Гостевой чат занят. Дождитесь ответа или повторите немного позже");
  rateLimit(req,"guest-chat",30,60*60000);
  guestRequests.add(guest.hash);
  try {
    if (!process.env.OPENAI_API_KEY) fail(503,"Серверу не задан OPENAI_API_KEY");
    enforceFreeApiBudget();
    reserveGuestAttempt(req);
    const result = await askModel(await baseRequest(GUEST_CASE,guest.messages,message,[],mode,true,true));
    const previousMessages = guest.messages;
    const previousUsed=guest.used,previousDraft=guest.draftUsed;
    const previousCostCount=store.db.providerUsage?.length||0;
    guest.messages = [...previousMessages,
      {id:randomId(),role:"user",text:message,mode,requestId,createdAt:now()},
      {id:randomId(),role:"assistant",text:result.text,sources:result.sources,mode,requestId,createdAt:now()}];
    if(mode==="draft")guest.draftUsed=true;
    else guest.used++;
    recordProviderUsage(result,null,true);
    try { store.save(); }
    catch (error) {
      guest.used=previousUsed;guest.draftUsed=previousDraft;guest.messages=previousMessages;
      if(store.db.providerUsage)store.db.providerUsage.length=previousCostCount;
      throw error;
    }
    return json(res,200,guestStatus(guest,req));
  } finally {
    guestRequests.delete(guest.hash);
  }
}
function ownedCase(req, id) {
  const u = requireUser(req), c = store.getCase(u.id, id);
  if (!c) fail(404,"Дело не найдено");
  return { u, c };
}
async function askModel(payload) {
  if (!process.env.OPENAI_API_KEY) fail(503,"Серверу не задан OPENAI_API_KEY");
  let response, data;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{ "authorization":"Bearer " + process.env.OPENAI_API_KEY, "content-type":"application/json" },
      body:JSON.stringify(payload), signal:AbortSignal.timeout(120000),
    });
    data = await response.json();
  } catch (e) {
    const timedOut=e.name==="TimeoutError" || e.name==="AbortError";
    console.error("ai_model_transport",timedOut?"timeout":"connection_error",e.code||"");
    fail(timedOut?504:502,timedOut
      ? "Ответ модели превысил две минуты. Повторите запрос короче либо без вложений."
      : "Не удалось связаться с AI. Проверьте подключение и повторите запрос.");
  }
  if (!response.ok) {
    // No client text, credentials, or upstream error message is written to logs.
    console.error("ai_model_provider",response.status,String(data?.error?.code||"").slice(0,50));
    if(response.status===429)fail(503,"AI временно ограничил число запросов. Повторите позже.");
    fail(502,"Поставщик AI вернул ошибку (" + response.status + "). Повторите запрос позже.");
  }
  const parsed = extractOutput(data);
  if (!parsed.text) fail(502,"Модель не вернула текстового ответа");
  return { ...parsed, usage:data.usage || null,model:payload.model,
    webCalls:Array.isArray(data.output)?data.output.filter(x=>x.type==="web_search_call").length:0 };
}
async function baseRequest(caseData, history, message, docs, mode, creditAccount=false,freeTier=false) {
  const legalQuery=message+" "+(caseData.objective||"");
  const matchingActs=selectOfficialSources(officialSources,legalQuery,{max:6})
    .map(x=>x.actId);
  const historic=await getTimelineOfficialContext(officialSources,legalQuery);
  const liveNormContext=historic.historical?historic.context:
    await getLiveOfficialArticleContext(officialSources,legalQuery);
  const localNormContext=liveNormContext+buildLegalContext(localNorms,legalQuery)+
    buildArticleSnapshotContext(officialArticleSnapshots,legalQuery,{
      limit:3,relatedActIds:matchingActs
    })+
    sourcePointerContext(officialSources,legalQuery,{max:4});
  const input = buildMessages(creditAccount?history.slice(-10):history, message, docs,
    { ...caseData, mode, localNormContext });
  const officialTextFetched=/(?:АРХИВНЫЕ ТЕКСТЫ ИЗ ИСТОРИИ|ОНЛАЙН-ИЗВЛЕЧЕНИЕ ИЗ ОФИЦИАЛЬНОЙ)/.test(localNormContext);
  const provenanceInstruction=officialTextFetched
    ? "\nПРОВЕРКА ИСТОЧНИКОВ: Сервер уже получил тексты указанных норм с официальных страниц Әділет; они находятся в контексте ДЕЛО. НЕ утверждай, что у тебя нет доступа к их тексту, и НЕ выдавай их за результат лишь собственной памяти. Ссылайся на официальный URL каждого извлечённого положения. Не путай получение текста с подтверждением действия конкретной редакции в дату события. Когда в вопросе несколько дат, отдельно применяй нормы на каждую юридически значимую дату; не утверждай, что сноски и даты введения проверены, если они не получены."
    : "\nЕсли официальный текст в серверном контексте отсутствует, честно обозначь отсутствие подтверждённого текста.";
  const needsDetailedAnswer=/(?:полноценн|подробн|полный\s+юридическ|проведи\s+(?:полный|юридический)|алгоритм\s+защит)/iu.test(message);
  return {
    model:freeTier?FREE_MODEL:MODEL, store:false, instructions:strategyInstruction(strategy+"\n\n"+practiceMethods+"\n\n"+
      selectLegalPlaybooks(playbooks,message,caseData.summary),mode)+provenanceInstruction,
    reasoning:{ effort:"medium" }, max_output_tokens:creditAccount?(mode==="consult"?(needsDetailedAnswer?5400:3300):5000):6500,
    ...(SEARCH_ENABLED ? { tools:[{ type:"web_search", search_context_size:"medium", filters:{ allowed_domains:["adilet.zan.kz","zan.gov.kz","gov.kz","sud.gov.kz","egov.kz"] } }] } : {}),
    input,
  };
}
function countToday(userId) {
  const date = new Date().toISOString().slice(0,10);
  return store.db.usage.filter(u => u.userId === userId && u.date === date).reduce((n,u)=>n+u.count,0);
}
function charge(userId,credits=1) {
  const date = new Date().toISOString().slice(0,10);
  const usage = store.db.usage.find(x=>x.userId === userId && x.date === date);
  if (usage) usage.count+=credits; else store.db.usage.push({userId,date,count:credits});
  store.db.usage = store.db.usage.filter(u => u.date >= new Date(Date.now()-14*86400000).toISOString().slice(0,10));
}
function verifyCreditAccess(user,cost){
  const limit=user.accountType==="paid"?Math.max(DAILY_LIMIT,5000):DAILY_LIMIT;
  if(countToday(user.id)+cost>limit)
    fail(429,"Дневной лимит AI-токенов исчерпан. Обновится в 00:00 UTC");
  if(!canSpend(user,cost))
    fail(402,"Недостаточно AI-токенов. Выберите пакет пополнения в разделе «Тарифы». Оплата пока подключается.");
}
function completeCreditOperation(user,cost){
  spendCredits(user,cost);
  charge(user.id,cost);
}
function snapshotBilling(user,caseData) {
  return {userCredits:user.credits,hadCredits:Object.hasOwn(user,"credits"),
    used:store.db.usage.map(x=>({...x})),
    messageCount:store.db.messages.length,costCount:store.db.providerUsage?.length||0,
    updatedAt:caseData.updatedAt,summary:caseData.summary};
}
function rollbackBilling(user,caseData,before) {
  if(before.hadCredits)user.credits=before.userCredits;
  else delete user.credits;
  store.db.usage=before.used;
  store.db.messages.length=before.messageCount;
  if(store.db.providerUsage)store.db.providerUsage.length=before.costCount;
  caseData.updatedAt=before.updatedAt;
  caseData.summary=before.summary;
}
function commitBilledAnswer(user,caseData,cost,mutation) {
  const before=snapshotBilling(user,caseData);
  try {
    mutation();
    completeCreditOperation(user,cost);
    // Charge is durable only when the assistant reply is durably saved.
    store.save();
  } catch(error) {
    rollbackBilling(user,caseData,before);
    throw error;
  }
}
function profile(user){
  return {balance:displayTokens(balanceOf(user)),
    dailyUsed:user?displayTokens(countToday(user.id)):0,
    dailyLimit:displayTokens(user?.accountType==="paid"?Math.max(DAILY_LIMIT,5000):DAILY_LIMIT),
    priceUnit:"токены AI Lawyer",prices:{
    consult:displayTokens(aiTokenCost("consult")),audit:displayTokens(aiTokenCost("audit")),
    strategy:displayTokens(aiTokenCost("strategy")),draft:displayTokens(aiTokenCost("draft")),
    review:displayTokens(aiTokenCost("review")),compact:displayTokens(aiTokenCost("compact"))
  }};
}

async function api(req,res,url) {
  const p = url.pathname;
  if(req.method==="GET"&&p==="/chat/api/legal/sources"){
    const q=String(url.searchParams.get("q")||"").trim().slice(0,400);
    const matches=q?selectOfficialSources(officialSources,q,{max:8}):officialSources;
    return json(res,200,{sources:matches.map(x=>({
      id:x.id,title:x.title,officialUrl:x.officialUrl,historyUrl:x.historyUrl,
      metadataCheckedAt:x.metadataCheckedAt,reviewState:x.reviewState,
      ...(x.transition?{transition:x.transition}:{})
    })),count:matches.length,verifiedArticles:localNorms.length,
      note:"Это каталог официальных актов, а не проверенные тексты статей и редакций."});
  }
  if(req.method==="GET"&&p==="/chat/api/legal/articles"){
    const q=String(url.searchParams.get("q")||"").trim().slice(0,400);
    const relatedActIds=selectOfficialSources(officialSources,q,{max:8}).map(x=>x.actId);
    const matches=q?retrieveArticleSnapshots(officialArticleSnapshots,q,{
      limit:5,relatedActIds
    }):[];
    return json(res,200,{articles:matches.map(x=>({
      id:x.id,article:x.article,actId:x.actId,sourceUrl:x.canonicalUrl,
      capturedFrom:x.capturedFrom,capturedOn:x.snapshotDate,ageDays:x.ageDays,
      sha256:x.sha256,excerpt:x.text.slice(0,1700),
      effectiveDateVerified:false,editionDateVerified:false
    })),count:matches.length,
      note:"Найдено в тексте официальной страницы. Дата действия редакции и применимость к прошлому делу не проверены."});
  }
  if (req.method === "GET" && p === "/chat/api/legal/status") {
    return json(res,200,{...legalCorpusStatus(localNorms),
      ...officialSourceStatus(officialSources),
      ...articleSnapshotStatus(officialArticleSnapshots),
      liveOfficialFetchingEnabled:process.env.LIVE_OFFICIAL_LAW_ENABLED!=="0",
      note:"Есть снимки отдельных статей из официального текста. Их дата выгрузки не равна дате вступления в силу; проверенные исторические редакции пока отсутствуют."});
  }
  if (req.method === "GET" && p === "/chat/api/session") {
    const user = sessionFor(req);
    return json(res,200,{
      authenticated:!!user,user:user?safeUser(user):null,
      configured:!!process.env.OPENAI_API_KEY,dailyLimit:displayTokens(user?.accountType==="paid"?Math.max(DAILY_LIMIT,5000):DAILY_LIMIT),
      packages:PACKAGES,paymentsEnabled:false,
      signupMode:mailEnabled()?"email":process.env.SIGNUP_INVITE_CODE?"invite":"disabled",
      emailVerificationEnabled:mailEnabled(),referralBonus:displayTokens(REFERRAL_BONUS),
      prices:profile(user).prices,
      ...(user?profile(user):{}),
      googleEnabled:googleEnabled(), googleSignupEnabled:googleEnabled()&&process.env.GOOGLE_SIGNUP_ENABLED==="1",
      guestEnabled:GUEST_ENABLED, trialCredits:displayTokens(TRIAL_CREDITS)
    });
  }
  if (GUEST_ENABLED && (p === "/chat/api/guest" || p === "/chat/api/guest/chat")) {
    if (sessionFor(req)) fail(409,"Вы уже вошли в кабинет");
    if (req.method === "GET" && p.endsWith("/guest")) return openGuest(req,res);
    if (req.method === "POST" && p.endsWith("/chat")) return guestChat(req,res);
    fail(405,"Метод не поддерживается");
  }
  if(p==="/chat/api/admin/referrals/disable"&&req.method==="POST"){
    if(!adminAuthorized(req.socket.remoteAddress,req.headers["x-ai-lawyer-admin-key"],process.env.REFERRAL_ADMIN_KEY))
      fail(403,"Administrative access denied");
    const b=await bodyJson(req),code=normalizeReferral(b.code);
    const campaign=(store.db.referrals||[]).find(x=>x.code===code);
    if(!campaign)fail(404,"Кампания не найдена");
    campaign.active=false;campaign.disabledAt=now();store.save();
    return json(res,200,{code,disabled:true});
  }
  if(p==="/chat/api/admin/referrals"&&["POST","GET"].includes(req.method)){
    if(!adminAuthorized(req.socket.remoteAddress,req.headers["x-ai-lawyer-admin-key"],process.env.REFERRAL_ADMIN_KEY))
      fail(403,"Administrative access denied");
    if(req.method==="GET")return json(res,200,{campaigns:(store.db.referrals||[]).map(c=>({
      code:c.code,partner:c.partner,active:c.active,credits:c.credits,
      redemptions:c.redemptions,maxRedemptions:c.maxRedemptions,createdAt:c.createdAt
    }))});
    const b=await bodyJson(req);
    let campaign;
    try{campaign=createCampaign(store.db,{partner:b.partner,maxRedemptions:b.maxRedemptions??5});}
    catch(e){fail(400,e.message);}
    store.save();
    return json(res,201,{
      campaign,link:ORIGIN+"/chat/?ref="+encodeURIComponent(campaign.code)
    });
  }
  if (req.method === "POST" && p === "/chat/api/auth/register") {
    // Once SMTP is connected, bypassing email verification via the old shared
    // invitation code must not be possible. Existing accounts still log in.
    if(mailEnabled())fail(403,"Новые пользователи должны подтвердить email");
    rateLimit(req,"auth",8,15*60000);
    const b = await bodyJson(req), email = validateEmail(b.email);
    if (!process.env.SIGNUP_INVITE_CODE || b.invite !== process.env.SIGNUP_INVITE_CODE) fail(403,"Регистрация доступна только по приглашению");
    if (!email || !validPassword(b.password)) fail(400,"Нужны корректная почта и пароль не короче 12 символов");
    if (store.db.users.some(u=>u.email===email)) fail(409,"Адрес уже зарегистрирован");
    ensureGuestIdle(req);
    const u={id:randomId(), email, pass:hashPassword(b.password), createdAt:now(),
      credits:TRIAL_CREDITS,accountType:"trial",freeCreditVersion:2};
    store.db.users.push(u); const guestCaseId=saveGuestConversation(req,u,null,true);
    store.save(); newSession(u,res,b.remember===true);
    return json(res,201,{user:safeUser(u),guestCaseId});
  }
  if (req.method === "POST" && p === "/chat/api/auth/email-start") {
    if(!mailEnabled())fail(503,"Для свободной регистрации нужно подключить отправку писем SMTP");
    rateLimit(req,"email-start",3,60*60000);
    const b=await bodyJson(req),email=validateEmail(b.email);
    if(!email||!validPassword(b.password))fail(400,"Проверьте email и пароль (минимум 12 символов)");
    if(store.db.users.some(u=>u.email===email))fail(409,"Этот адрес уже зарегистрирован");
    const referralCode=normalizeReferral(b.referralCode);
    if(referralCode===null)fail(400,"Некорректный партнёрский код");
    if(referralCode&&!campaignByCode(store.db,referralCode))
      fail(400,"Партнёрский код недействителен или лимит регистраций исчерпан");
    const code=newEmailCode();
    ensureGuestIdle(req);
    const pending={email,pass:hashPassword(b.password),codeHash:emailCodeHash(email,code,KEY),
      referralCode,referralSource:safeSource(b.referralSource),
      guestHash:guestFor(req)?.hash || null,
      expiresAt:Date.now()+15*60000,attempts:0,remember:b.remember===true};
    store.db.pendingSignups=(store.db.pendingSignups||[]).filter(x=>x.expiresAt>Date.now()&&x.email!==email);
    if(store.db.pendingSignups.length>=1000)fail(429,"Регистрация временно ограничена");
    store.db.pendingSignups.push(pending);store.save();
    try{await sendVerificationCode(email,code);}
    catch{
      store.db.pendingSignups=store.db.pendingSignups.filter(x=>x!==pending);store.save();
      fail(503,"Не удалось отправить письмо. Повторите позднее");
    }
    return json(res,200,{verificationRequired:true,expiresMinutes:15});
  }
  if (req.method === "POST" && p === "/chat/api/auth/email-verify") {
    rateLimit(req,"email-verify",10,15*60000);
    const b=await bodyJson(req),email=validateEmail(b.email);
    if(!email)fail(400,"Некорректный email");
    const pending=(store.db.pendingSignups||[]).find(x=>x.email===email&&x.expiresAt>Date.now());
    if(!pending)fail(400,"Код отсутствует или истёк. Запросите новый");
    ensureGuestIdle(req);
    if(pending.guestHash && guestRequests.has(pending.guestHash))
      fail(409,"Дождитесь окончания гостевого ответа и повторите регистрацию");
    pending.attempts++;
    const success=pending.attempts<=5&&emailCodeMatches(email,b.code,pending.codeHash,KEY);
    if(pending.attempts>=5||success)store.db.pendingSignups=store.db.pendingSignups.filter(x=>x!==pending);
    store.save();
    if(!success)fail(400,"Неверный код подтверждения");
    if(store.db.users.some(u=>u.email===email))fail(409,"Этот адрес уже зарегистрирован");
    let grant;
    try{grant=allocateVerifiedRegistration(store.db,pending.referralCode);}
    catch{fail(409,"Партнёрский код больше недействителен. Начните регистрацию заново");}
    const u={id:randomId(),email,pass:pending.pass,emailVerified:true,createdAt:now(),
      credits:grant.credits,accountType:"trial",freeCreditVersion:2,referralCode:grant.referralCode,
      referralSource:pending.referralSource||null};
    store.db.users.push(u);
    const guestCaseId=saveGuestConversation(req,u,pending.guestHash,true);
    store.save();newSession(u,res,pending.remember);
    return json(res,201,{user:safeUser(u),guestCaseId});
  }
  // Password reset always verifies control of the registered email address.
  // Never reveal whether an email belongs to an account.
  if (req.method === "POST" && p === "/chat/api/auth/password-reset-start") {
    if(!mailEnabled())fail(503,"Восстановление пароля временно недоступно");
    rateLimit(req,"password-reset-start",3,60*60000);
    const b=await bodyJson(req),email=validateEmail(b.email);
    if(!email)fail(400,"Укажите корректный email");
    const user=store.db.users.find(u=>u.email===email);
    store.db.passwordResets=(store.db.passwordResets||[]).filter(x=>x.expiresAt>Date.now()&&x.email!==email);
    if(user){
      const code=newEmailCode();
      store.db.passwordResets.push({
        email,userId:user.id,codeHash:emailCodeHash(email,code,KEY),
        expiresAt:Date.now()+15*60000,attempts:0
      });
      store.save();
      try{await sendPasswordResetCode(email,code);}
      catch{
        store.db.passwordResets=store.db.passwordResets.filter(x=>x.email!==email);
        store.save();
        // An SMTP failure must not disclose whether this account exists.
      }
    }
    return json(res,200,{message:"Если адрес зарегистрирован, мы отправили код восстановления. Проверьте входящие и спам."});
  }
  if (req.method === "POST" && p === "/chat/api/auth/password-reset-complete") {
    if(!mailEnabled())fail(503,"Восстановление пароля временно недоступно");
    rateLimit(req,"password-reset-complete",10,15*60000);
    const b=await bodyJson(req),email=validateEmail(b.email);
    if(!email||!validPassword(b.password)||!/^[0-9]{6}$/.test(String(b.code||"")))
      fail(400,"Проверьте email, шестизначный код и новый пароль (минимум 12 символов)");
    const pending=(store.db.passwordResets||[]).find(x=>x.email===email&&x.expiresAt>Date.now());
    if(!pending)fail(400,"Неверный или истёкший код восстановления");
    pending.attempts++;
    const verified=pending.attempts<=5&&emailCodeMatches(email,b.code,pending.codeHash,KEY);
    if(verified||pending.attempts>=5)
      store.db.passwordResets=store.db.passwordResets.filter(x=>x.email!==email);
    if(!verified){store.save();fail(400,"Неверный или истёкший код восстановления");}
    const user=store.db.users.find(u=>u.id===pending.userId&&u.email===email);
    if(!user){store.save();fail(400,"Неверный или истёкший код восстановления");}
    user.pass=hashPassword(b.password);
    user.passwordChangedAt=now();
    store.db.sessions=store.db.sessions.filter(x=>x.userId!==user.id);
    store.save();
    return json(res,200,{ok:true,message:"Пароль изменён. Войдите с новым паролем."});
  }
  if (req.method === "POST" && p === "/chat/api/auth/login") {
    rateLimit(req,"auth",8,15*60000);
    const b=await bodyJson(req), email=validateEmail(b.email);
    const user=store.db.users.find(u=>u.email===email);
    if (!user || !checkPassword(String(b.password||""),user.pass)) fail(401,"Неверная почта или пароль");
    ensureGuestIdle(req);
    const guestCaseId=saveGuestConversation(req,user);
    newSession(user,res,b.remember===true);
    return json(res,200,{user:safeUser(user),guestCaseId});
  }
  if (req.method === "POST" && p === "/chat/api/auth/logout") {
    const token=cookies(req).al_session;
    if (token) store.db.sessions=store.db.sessions.filter(s=>s.hash!==tokenHash(token));
    store.save(); res.setHeader("set-cookie",sessionCookie("",0));
    return json(res,200,{ok:true});
  }
  if (req.method === "GET" && p === "/chat/api/cases") {
    const u=requireUser(req);
    const cases=store.db.cases.filter(c=>c.ownerId===u.id&&!c.deletedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(c=>store.publicCase(c));
    return json(res,200,{cases,usedToday:displayTokens(countToday(u.id)),...profile(u)});
  }
  if (req.method === "POST" && p === "/chat/api/cases") {
    const u=requireUser(req), b=await bodyJson(req);
    if (store.db.cases.filter(c=>c.ownerId===u.id&&!c.deletedAt).length >= MAX_CASES_PER_USER) fail(400,"Достигнут лимит дел");
    const title=String(b.title||"").trim().slice(0,160), objective=String(b.objective||"").trim().slice(0,1000);
    if (!title) fail(400,"Укажите название дела");
    const c={id:randomId(),ownerId:u.id,title,objective,summary:"",
      dossier:blankDossier(),dossierHistory:[],createdAt:now(),updatedAt:now()};
    store.db.cases.push(c);store.save();
    return json(res,201,{case:store.publicCase(c)});
  }
  const match = p.match(/^\/chat\/api\/cases\/([a-f0-9-]{36})(?:\/(documents|chat|compact|dossier))?(?:\/([a-f0-9-]{36}))?$/);
  if (!match) fail(404,"Ресурс не найден");
  const id=match[1], action=match[2], subId=match[3];
  const {u,c}=ownedCase(req,id);

  if (req.method==="GET" && action==="dossier" && !subId) {
    const messages=store.db.messages.filter(m=>m.caseId===id);
    const documents=store.db.documents.filter(d=>d.caseId===id);
    return json(res,200,dossierView(c,messages,documents));
  }
  if (req.method==="PATCH" && action==="dossier" && !subId) {
    const body=await bodyJson(req,115000);
    const messages=store.db.messages.filter(m=>m.caseId===id);
    const documents=store.db.documents.filter(d=>d.caseId===id);
    const next=validateDossier(body,c.dossier||blankDossier(),documents,messages);
    const previous=c.dossier,priorHistory=c.dossierHistory,priorUpdated=c.updatedAt;
    c.dossier=next;
    c.dossierHistory=[...(priorHistory||[]),
      ...(previous?.revision>0?[{...previous,archivedAt:now()}]:[])].slice(-20);
    c.updatedAt=now();
    try{store.save();}
    catch(e){c.dossier=previous;c.dossierHistory=priorHistory;c.updatedAt=priorUpdated;throw e;}
    return json(res,200,dossierView(c,messages,documents));
  }
  if (req.method==="GET" && !action) {
    const messages=store.db.messages.filter(m=>m.caseId===id).map(m=>store.publicMessage(m));
    const documents=store.db.documents.filter(d=>d.caseId===id).map(d=>store.publicDocument(d));
    return json(res,200,{case:store.publicCase(c),messages,documents});
  }
  if (req.method==="PATCH" && !action) {
    const b=await bodyJson(req);
    if (typeof b.title==="string" && b.title.trim()) c.title=b.title.trim().slice(0,160);
    if (typeof b.objective==="string") c.objective=b.objective.slice(0,1000);
    c.updatedAt=now();store.save();
    return json(res,200,{case:store.publicCase(c)});
  }
  if (req.method==="DELETE" && !action) {
    const b=await bodyJson(req);
    if (b.confirm!=="УДАЛИТЬ") fail(400,"Нужно явное подтверждение удаления");
    for(const d of store.db.documents.filter(d=>d.caseId===id)) store.deleteFile(d.id);
    store.db.documents=store.db.documents.filter(d=>d.caseId!==id);
    store.db.messages=store.db.messages.filter(m=>m.caseId!==id);
    c.deletedAt=now();c.summary="";c.dossier=null;c.dossierHistory=[];store.save();
    return json(res,200,{deleted:true});
  }
  if (req.method==="POST" && action==="documents" && !subId) {
    const count=store.db.documents.filter(d=>d.caseId===id).length;
    if (count>=MAX_DOCS_PER_CASE) fail(400,"Для дела превышен лимит документов");
    const name=decodeURIComponent(String(req.headers["x-filename"]||"document.pdf"));
    const bytes=await readBody(req,MAX_FILE_BYTES);
    const f=classifyFile(name,bytes);
    if (!f) fail(400,"Поддерживаются PDF, Word, изображения и текст до 7 МБ");
    const d={id:randomId(),caseId:id,ownerId:u.id,...f,size:bytes.length,createdAt:now()};
    store.writeFile(d.id,bytes);
    store.db.documents.push(d);c.updatedAt=now();store.save();
    return json(res,201,{document:store.publicDocument(d)});
  }
  if (req.method==="DELETE" && action==="documents" && subId) {
    const d=store.db.documents.find(d=>d.id===subId && d.caseId===id && d.ownerId===u.id);
    if (!d) fail(404,"Документ не найден");
    store.deleteFile(d.id);
    store.db.documents=store.db.documents.filter(x=>x.id!==d.id);
    c.updatedAt=now();store.save();return json(res,200,{deleted:true});
  }
  if (req.method==="POST" && action==="chat") {
    rateLimit(req,"chat",40,60000);
    const b=await bodyJson(req);
    const message=String(b.message||"").trim();
    const mode=["consult","audit","strategy","draft","review"].includes(b.mode)?b.mode:"consult";
    if (!message || message.length>MAX_MESSAGE_CHARS) fail(400,"Сообщение пустое или слишком длинное");
    const requestId=b.requestId===undefined ? null : String(b.requestId);
    if(requestId!==null && !/^[a-f0-9-]{36}$/i.test(requestId))
      fail(400,"Некорректный идентификатор запроса");
    const already=requestId
      ? store.db.messages.find(m=>m.caseId===id && m.role==="assistant" && m.requestId===requestId)
      : null;
    if(already) {
      const original=store.db.messages.find(m=>m.caseId===id && m.role==="user" && m.requestId===requestId);
      if(!original || original.text!==message || original.mode!==mode)
        fail(409,"Идентификатор запроса уже использован для другого сообщения");
      return json(res,200,{answer:already.text,sources:already.sources||[],
        cost:0,alreadyProcessed:true,...profile(u)});
    }
    const ids=Array.isArray(b.docIds)?[...new Set(b.docIds)]:[];
    if(ids.length>MAX_USER_DOCS_PER_CHAT) fail(400,"Выберите не более трёх документов за один запрос");
    const docs=ids.map(docId=>{
      const d=store.db.documents.find(x=>x.id===docId && x.caseId===id && x.ownerId===u.id);
      if(!d) fail(404,"Документ не найден в данном деле");
      return {...d,bytes:store.readFile(d.id)};
    });
    const cost=aiTokenCost(mode,docs.length);
    if(balanceOf(u)!==null&&docs.reduce((sum,d)=>sum+d.bytes.length,0)>1500000)
      fail(413,"Пробный тариф: объём выбранных файлов для одного анализа не должен превышать 1,5 МБ");
    verifyCreditAccess(u,cost);
    if(u.accountType==="trial")enforceFreeApiBudget();
    if(activeModelRequests.has(u.id))fail(429,"Другой запрос уже обрабатывается. Дождитесь ответа");
    activeModelRequests.add(u.id);
    try {
    const history=store.db.messages.filter(m=>m.caseId===id);
    const first=await askModel(await baseRequest(c,history,message,docs,mode,balanceOf(u)!==null,u.accountType==="trial"));
    let result=first,critiqueResult=null;
    if (["strategy","review"].includes(mode) && process.env.SECOND_PASS_ENABLED!=="0") {
      // An actual separate skeptical review, not a claim that one was conducted.
      const critique = await askModel({
        model:u.accountType==="trial"?FREE_MODEL:MODEL,store:false,max_output_tokens:balanceOf(u)!==null?3000:4500,reasoning:{effort:"medium"},
        instructions:"Ты независимый юридический ревизор Республики Казахстан. Найди фактические, доказательственные, процессуальные и нормативные ошибки. Не придумывай нормы и не подтверждай их без источников. Дай ИСПРАВЛЕННУЮ окончательную позицию, сохрани сильные аргументы, укажи степень достоверности.",
        input:`Задача клиента: ${message}\nКарточка дела: ${c.title} / ${c.objective}; контекст: ${(c.summary||"").slice(0,7000)}\nПервоначальный ответ: ${first.text}\nСделай независимую проверку и напиши итоговый ответ.`,
      });
      critiqueResult=critique;
      result={text:critique.text,sources:[...first.sources,...critique.sources.filter(s=>!first.sources.some(t=>t.url===s.url))]};
    }
    const time=now();
    commitBilledAnswer(u,c,cost,()=>{
      recordProviderUsage(first,u,u.accountType==="trial");
      if(critiqueResult)recordProviderUsage(critiqueResult,u,u.accountType==="trial");
      store.db.messages.push({id:randomId(),caseId:id,role:"user",text:message,mode,requestId,createdAt:time});
      store.db.messages.push({id:randomId(),caseId:id,role:"assistant",text:result.text,
        sources:result.sources,mode,requestId,createdAt:now()});
      c.updatedAt=now();
    });
    return json(res,200,{answer:result.text,sources:result.sources,cost:displayTokens(cost),
      ...profile(u),rechecked:["strategy","review"].includes(mode)&&process.env.SECOND_PASS_ENABLED!=="0"});
    } finally {activeModelRequests.delete(u.id);}
  }
  if (req.method==="POST" && action==="compact") {
    const cost=aiTokenCost("compact");
    verifyCreditAccess(u,cost);
    if(u.accountType==="trial")enforceFreeApiBudget();
    if(activeModelRequests.has(u.id))fail(429,"Другой запрос уже обрабатывается. Дождитесь ответа");
    const messages=store.db.messages.filter(m=>m.caseId===id).slice(balanceOf(u)!==null?-25:-80);
    if(!messages.length) fail(400,"В деле пока нет сообщений");
    activeModelRequests.add(u.id);
    try {
    const digest=await askModel({
      model:u.accountType==="trial"?FREE_MODEL:MODEL,store:false,max_output_tokens:balanceOf(u)!==null?2400:3600,
      instructions:"Создай обновлённую структурированную, нейтральную карточку юридического дела на русском. Не выдумывай факты. Сохрани старые версии и противоречия, укажи источники если даны. Структура: ЦЕЛЬ; СТОРОНЫ; ДОКУМЕНТЫ; ХРОНОЛОГИЯ; ДОКАЗАННЫЕ ФАКТЫ; УТВЕРЖДЕНИЯ; ГИПОТЕЗЫ; ПРОТИВОРЕЧИЯ; НЕХВАТКА ДОКАЗАТЕЛЬСТВ; СРОКИ; ПРОЦЕССУАЛЬНЫЕ ВАРИАНТЫ; РИСКИ; СЛЕДУЮЩИЙ ШАГ. Никогда не выдавай гипотезу за факт.",
      input:`Название: ${c.title}\nЦель: ${c.objective}\nПрежняя карточка:\n${c.summary}\nИстория:\n${messages.map(m=>m.role+": "+m.text).join("\n\n").slice(-85000)}`,
    });
    commitBilledAnswer(u,c,cost,()=>{
      recordProviderUsage(digest,u,u.accountType==="trial");
      c.summary=digest.text.slice(0,30000);c.updatedAt=now();
    });
    return json(res,200,{summary:c.summary,cost:displayTokens(cost),...profile(u)});
    } finally {activeModelRequests.delete(u.id);}
  }
  fail(404,"Неподдерживаемое действие");
}
async function sendExportResponse(req,res,message,format) {
  if(format!=="pdf" && format!=="docx") fail(400,"Поддерживаются Word (.docx) и PDF");
  rateLimit(req,"export",25,60*60*1000);
  const bytes=format==="pdf" ? await exportPdf(message.text) : await exportDocx(message.text);
  const type=format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  res.writeHead(200,{
    "content-type":type,
    "content-length":bytes.length,
    "content-disposition":'attachment; filename="ai-lawyer-'+message.id.slice(0,8)+"."+format+'"',
    "cache-control":"no-store",
    "x-content-type-options":"nosniff"
  });
  return res.end(bytes);
}
const server=http.createServer(async(req,res)=>{
  res.setHeader("x-content-type-options","nosniff");
  res.setHeader("x-frame-options","DENY");
  res.setHeader("referrer-policy","no-referrer");
  res.setHeader("cache-control","no-store");
  res.setHeader("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  try {
    const url=new URL(req.url,"http://localhost");
    if (req.method==="GET" && (url.pathname==="/chat/" || url.pathname==="/chat")) {
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});return res.end(HTML);
    }
    if(req.method==="GET" && url.pathname==="/chat/app.js"){
      res.writeHead(200,{"content-type":"text/javascript; charset=utf-8"});return res.end(JS);
    }
    if(req.method==="GET" && url.pathname==="/chat/format.js"){
      res.writeHead(200,{"content-type":"text/javascript; charset=utf-8"});return res.end(FORMAT_JS);
    }
    if(req.method==="GET" && url.pathname==="/chat/logo.svg"){
      res.writeHead(200,{"content-type":"image/svg+xml"});return res.end(logo);
    }
    if(req.method==="GET" && url.pathname==="/chat/health"){
      return json(res,200,{ok:true,configured:!!process.env.OPENAI_API_KEY});
    }
    if(req.method==="GET"&&url.pathname==="/chat/auth/google/start"){
      if(!googleEnabled())fail(503,"Вход через Google пока не подключён");
      rateLimit(req,"google-start",20,15*60000);
      const link=url.searchParams.get("link")==="1";
      const user=link?requireUser(req):null;
      const referralCode=link?"":normalizeReferral(url.searchParams.get("ref"));
      if(referralCode===null)fail(400,"Некорректный партнёрский код");
      if(referralCode&&!campaignByCode(store.db,referralCode))
        fail(400,"Партнёрский код недействителен или лимит исчерпан");
      const raw=cookies(req).al_session;
      const linkedSession=user?store.db.sessions.find(x=>x.userId===user.id&&x.hash===tokenHash(raw)):null;
      const flow=googleStart({
        origin:ORIGIN,key:KEY,
        remember:link?linkedSession?.remember===true:url.searchParams.get("remember")==="1",
        linkUserId:user?.id||null,linkSessionHash:user?tokenHash(raw):null,
        referralCode,referralSource:safeSource(url.searchParams.get("src")),
        guestHash:guestFor(req)?.hash||null
      });
      res.writeHead(302,{"location":flow.url,"set-cookie":flow.cookie,"cache-control":"no-store"});
      return res.end();
    }
    if(req.method==="GET"&&url.pathname==="/chat/auth/google/callback"){
      if(!googleEnabled())fail(503,"Вход через Google пока не подключён");
      let stage="state";
      try{
        let flow;
        try{flow=verifyGoogleCookie(cookies(req).al_google_state,KEY);}
        catch(e){throw new GoogleOAuthError("GOOGLE_STATE_INVALID",0,e);}
        const state=url.searchParams.get("state");
        if(!state||state.length!==flow.state.length||
           !crypto.timingSafeEqual(Buffer.from(state),Buffer.from(flow.state)))
          throw new GoogleOAuthError("GOOGLE_STATE_INVALID");
        if(url.searchParams.has("error"))throw new GoogleOAuthError("GOOGLE_CANCELLED");
        stage="exchange";
        const identity=await googleIdentity(url.searchParams.get("code"),flow,ORIGIN);
        stage="account";
        let user, registered=false;
        if(flow.linkUserId){
          const validSession=store.db.sessions.some(x=>x.userId===flow.linkUserId&&
            x.hash===flow.linkSessionHash&&x.expiresAt>Date.now());
          if(!validSession)throw new GoogleOAuthError("GOOGLE_STATE_INVALID");
          user=store.db.users.find(x=>x.id===flow.linkUserId);
          if(!user||user.email!==identity.email||user.googleSub&&user.googleSub!==identity.sub)
            throw new GoogleOAuthError("GOOGLE_LINK_MISMATCH");
          if(store.db.users.some(x=>x.googleSub===identity.sub&&x.id!==user.id))
            throw new GoogleOAuthError("GOOGLE_LINK_MISMATCH");
          user.googleSub=identity.sub;user.emailVerified=true;store.save();
        }else{
          user=store.db.users.find(x=>x.googleSub===identity.sub);
          if(!user){
            if(store.db.users.some(x=>x.email===identity.email)) {
              res.writeHead(303,{"location":ORIGIN+"/chat/?auth_error=google_link_required",
                "set-cookie":clearGoogleCookie(ORIGIN.startsWith("https:"))});
              return res.end();
            }
            if(process.env.GOOGLE_SIGNUP_ENABLED!=="1")
              throw new GoogleOAuthError("GOOGLE_SIGNUP_DISABLED");
            ensureGuestIdle(req);
            reserveGoogleSignup(req);
            const grant=allocateVerifiedRegistration(store.db,flow.referralCode);
            user={id:randomId(),email:identity.email,pass:null,googleSub:identity.sub,
              emailVerified:true,createdAt:now(),credits:grant.credits,
              accountType:"trial",freeCreditVersion:2,referralCode:grant.referralCode,
              referralSource:flow.referralSource||null};
            store.db.users.push(user);saveGuestConversation(req,user,flow.guestHash,true);store.save();
            registered=true;
          } else {
            // Existing Google account: migrate the still-unclaimed guest chat too.
            ensureGuestIdle(req);
            if(saveGuestConversation(req,user,flow.guestHash))store.save();
          }
        }
        newSession(user,res,flow.remember);
        const set=res.getHeader("set-cookie");
        res.setHeader("set-cookie",[set,clearGoogleCookie(ORIGIN.startsWith("https:"))]);
        const notice=flow.linkUserId?"?auth_notice=google_linked":registered?"?auth_notice=google_registered":"";
        res.writeHead(303,{"location":ORIGIN+"/chat/"+notice});
        return res.end();
      }catch(e){
        const reason=googleOAuthFailure(e);
        // Explicit phase and sanitized network code only. Never log email,
        // auth code, cookies, access/id tokens, secrets or request body.
        const technical=String(e?.cause?.cause?.code||e?.cause?.code||"").slice(0,40);
        console.error("google_oauth_failed",stage,reason,
          Number.isInteger(e?.status)?e.status:0,
          /^[A-Z_]{2,40}$/.test(technical)?technical:"");
        res.writeHead(303,{"location":ORIGIN+"/chat/?auth_error="+reason,
          "set-cookie":clearGoogleCookie(ORIGIN.startsWith("https:"))});
        return res.end();
      }
    }
    if(req.method!=="GET" && !["POST","PATCH","DELETE"].includes(req.method)) fail(405,"Метод не поддерживается");
    if(req.method!=="GET") sameOrigin(req);
    const guestExportMatch=url.pathname.match(/^\/chat\/api\/guest\/export\/([a-f0-9-]{36})$/);
    if(req.method==="GET" && guestExportMatch) {
      const guest=guestFor(req);
      if(!guest) fail(401,"Гостевая сессия не найдена. Войдите в аккаунт");
      const message=guest.messages.find(m=>m.id===guestExportMatch[1] && m.role==="assistant");
      if(!message) fail(404,"Ответ не найден в этой гостевой переписке");
      return sendExportResponse(req,res,message,url.searchParams.get("format"));
    }
    const exportMatch=url.pathname.match(/^\/chat\/api\/cases\/([a-f0-9-]{36})\/export\/([a-f0-9-]{36})$/);
    if(req.method==="GET" && exportMatch) {
      const {c}=ownedCase(req,exportMatch[1]);
      const message=store.db.messages.find(m=>m.caseId===c.id && m.id===exportMatch[2] && m.role==="assistant");
      if(!message) fail(404,"Ответ не найден в этом деле");
      return sendExportResponse(req,res,message,url.searchParams.get("format"));
    }
    if(!url.pathname.startsWith("/chat/api/")) fail(404,"Ресурс не найден");
    await api(req,res,url);
  } catch(e){
    const status=e.status || 500;
    if(status===500) console.error("internal_error",e.name,e.code||"");
    if(!res.headersSent) json(res,status,{error:status===500?"Внутренняя ошибка сервера":e.message});
    else res.end();
  }
});
server.listen(PORT,process.env.HOST||"127.0.0.1",()=>console.log("AI Lawyer web listening on",server.address().port));
