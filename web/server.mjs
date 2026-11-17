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
  balanceOf,canSpend,spendCredits,adminAuthorized
} from "./referrals.mjs";
import {
  googleEnabled, mailEnabled, googleStart, googleIdentity, verifyGoogleCookie, clearGoogleCookie,
  newEmailCode, emailCodeHash, emailCodeMatches, sendVerificationCode, sendPasswordResetCode
} from "./auth.mjs";
import {
  Store, MAX_FILE_BYTES, MAX_MESSAGE_CHARS, MAX_CASES_PER_USER, MAX_DOCS_PER_CASE,
  validateEmail, validPassword, hashPassword, checkPassword, tokenHash, dataKey,
  randomId, classifyFile, extractOutput, buildMessages, strategyInstruction,
} from "./core.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8791);
const ORIGIN = String(process.env.PUBLIC_ORIGIN || "http://localhost:" + PORT).replace(/\/$/, "");
const KEY = dataKey(process.env.DATA_KEY);
const store = new Store(process.env.DATA_DIR || path.join(dirname, "private-data"), KEY);
const strategy = fs.readFileSync(path.join(dirname, "strategy", "LEGAL_ENGINE_V1.md"), "utf8");
const playbooks = fs.readFileSync(path.join(dirname, "strategy", "LEGAL_PLAYBOOKS_V1.md"), "utf8");
const MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
const SEARCH_ENABLED = process.env.ENABLE_LAW_SEARCH !== "0";
const DAILY_LIMIT = Math.max(1, Number(process.env.MAX_MESSAGES_PER_DAY || 25));
const MAX_USER_DOCS_PER_CHAT = 3;
const GUEST_LIMIT = 20;
const GUEST_REMINDER = 5;
const GUEST_MAX_AGE = 90 * 86400;
const GUEST_ENABLED = process.env.GUEST_CHAT_ENABLED !== "0";
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
  return store.db.users.find(x => x.id === s.userId) || null;
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
function rateLimit(req, bucket, limit, ms) {
  const remote = req.socket.remoteAddress || "?";
  const forwarded = String(req.headers["x-real-ip"] || "");
  // Trust X-Real-IP only from a local Nginx proxy configured to overwrite this header.
  const ip = (["127.0.0.1","::1","::ffff:127.0.0.1"].includes(remote) && net.isIP(forwarded)) ? forwarded : remote;
  const k = bucket + "|" + ip, entry = throttle.get(k) || { count:0, reset:0 };
  if (entry.reset < Date.now()) { entry.count = 0; entry.reset = Date.now() + ms; }
  entry.count++; throttle.set(k,entry);
  if (entry.count > limit) fail(429,"Слишком много запросов");
  if (throttle.size > 5000) for (const [key,value] of throttle) if (value.reset < Date.now()) throttle.delete(key);
}
function guestFor(req) {
  const token = cookies(req).al_guest;
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  const hash = tokenHash(token);
  return (store.db.guests || []).find(g => g.hash === hash && g.expiresAt > Date.now()) || null;
}
function guestStatus(guest) {
  const used = guest?.used || 0;
  return { used, remaining:GUEST_LIMIT-used, limit:GUEST_LIMIT,
    reminderAt:GUEST_REMINDER, messages:guest?.messages.map(m=>store.publicMessage(m)) || [] };
}
function openGuest(req,res) {
  const guest = guestFor(req);
  if (guest) return json(res,200,guestStatus(guest));
  rateLimit(req,"guest-start",20,60*60000);
  const token = crypto.randomBytes(32).toString("hex");
  const created = {hash:tokenHash(token),expiresAt:Date.now()+GUEST_MAX_AGE*1000,used:0,messages:[]};
  store.db.guests = (store.db.guests || []).filter(g=>g.expiresAt>Date.now());
  store.db.guests.push(created);
  store.save();
  const secure = ORIGIN.startsWith("https:") ? "; Secure" : "";
  return json(res,200,guestStatus(created),{
    "set-cookie":`al_guest=${token}; HttpOnly; SameSite=Lax; Path=/chat/; Max-Age=${GUEST_MAX_AGE}${secure}`
  });
}
function ensureGuestIdle(req) {
  if (guestRequests.has(guestFor(req)?.hash))
    fail(409,"Дождитесь ответа на гостевой вопрос и повторите регистрацию");
}
function saveGuestConversation(req,user) {
  const guest = guestFor(req);
  if (!guest?.messages.length) return;
  const id = randomId(), time = now();
  store.db.cases.push({...GUEST_CASE,id,ownerId:user.id,createdAt:time,updatedAt:time});
  store.db.messages.push(...guest.messages.map(m=>({...m,caseId:id})));
  guest.messages = [];
}
async function guestChat(req,res) {
  const body = await bodyJson(req);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) fail(400,"Сообщение пустое или слишком длинное");
  const guest = guestFor(req);
  if (!guest) fail(409,"Обновите страницу, чтобы открыть гостевой чат");
  if (guest.used >= GUEST_LIMIT) return json(res,403,{
    error:"Для продолжения зарегистрируйтесь или войдите",guest:guestStatus(guest)
  });
  if (guestRequests.has(guest.hash) || guestRequests.size >= 6)
    fail(429,"Гостевой чат занят. Дождитесь ответа или повторите немного позже");
  rateLimit(req,"guest-chat",80,60*60000);
  guestRequests.add(guest.hash);
  try {
    const result = await askModel(baseRequest(GUEST_CASE,guest.messages,message,[],"consult",true));
    const previousMessages = guest.messages;
    guest.messages = [...previousMessages,
      {id:randomId(),role:"user",text:message,mode:"consult",createdAt:now()},
      {id:randomId(),role:"assistant",text:result.text,sources:result.sources,mode:"consult",createdAt:now()}];
    guest.used++;
    try { store.save(); }
    catch (error) { guest.used--; guest.messages=previousMessages; throw error; }
    return json(res,200,guestStatus(guest));
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
  } catch (e) { fail(502,"Не удалось получить ответ модели: " + (e.name === "TimeoutError" ? "тайм-аут" : "ошибка соединения")); }
  if (!response.ok) {
    // Never return provider errors containing sensitive request details or API keys.
    fail(502,"Поставщик AI вернул ошибку (" + response.status + "). Проверьте модель, ключ и баланс API.");
  }
  const parsed = extractOutput(data);
  if (!parsed.text) fail(502,"Модель не вернула текстового ответа");
  return { ...parsed, usage:data.usage || null };
}
function baseRequest(caseData, history, message, docs, mode, creditAccount=false) {
  const input = buildMessages(creditAccount?history.slice(-10):history, message, docs, { ...caseData, mode });
  return {
    model:MODEL, store:false, instructions:strategyInstruction(strategy + "\n\n" + playbooks,mode),
    reasoning:{ effort:"medium" }, max_output_tokens:creditAccount?(mode==="consult"?2400:4000):6500,
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
  if(countToday(user.id)+cost>DAILY_LIMIT)
    fail(429,"Дневной лимит AI-токенов исчерпан. Обновится в 00:00 UTC");
  if(!canSpend(user,cost))
    fail(402,"Недостаточно AI-токенов. Пополнение пока недоступно");
}
function completeCreditOperation(user,cost){
  spendCredits(user,cost);
  charge(user.id,cost);
}
function profile(user){
  return {balance:balanceOf(user),dailyUsed:user?countToday(user.id):0,dailyLimit:DAILY_LIMIT,priceUnit:"AI-токены",prices:{
    consult:aiTokenCost("consult"),audit:aiTokenCost("audit"),
    strategy:aiTokenCost("strategy"),draft:aiTokenCost("draft"),
    review:aiTokenCost("review"),compact:aiTokenCost("compact")
  }};
}

async function api(req,res,url) {
  const p = url.pathname;
  if (req.method === "GET" && p === "/chat/api/session") {
    const user = sessionFor(req);
    return json(res,200,{
      authenticated:!!user,user:user?safeUser(user):null,
      configured:!!process.env.OPENAI_API_KEY,dailyLimit:DAILY_LIMIT,
      signupMode:mailEnabled()?"email":process.env.SIGNUP_INVITE_CODE?"invite":"disabled",
      emailVerificationEnabled:mailEnabled(),referralBonus:REFERRAL_BONUS,
      prices:profile(user).prices,
      ...(user?profile(user):{}),
      googleEnabled:googleEnabled(), guestEnabled:GUEST_ENABLED, trialCredits:TRIAL_CREDITS
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
    const u={id:randomId(), email, pass:hashPassword(b.password), createdAt:now()};
    store.db.users.push(u); saveGuestConversation(req,u); store.save(); newSession(u,res,b.remember===true);
    return json(res,201,{user:safeUser(u)});
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
    const pending={email,pass:hashPassword(b.password),codeHash:emailCodeHash(email,code,KEY),
      referralCode,referralSource:safeSource(b.referralSource),
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
      credits:grant.credits,accountType:"trial",referralCode:grant.referralCode,
      referralSource:pending.referralSource||null};
    store.db.users.push(u);saveGuestConversation(req,u);store.save();newSession(u,res,pending.remember);
    return json(res,201,{user:safeUser(u)});
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
    newSession(user,res,b.remember===true);
    return json(res,200,{user:safeUser(user)});
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
    return json(res,200,{cases,usedToday:countToday(u.id),...profile(u)});
  }
  if (req.method === "POST" && p === "/chat/api/cases") {
    const u=requireUser(req), b=await bodyJson(req);
    if (store.db.cases.filter(c=>c.ownerId===u.id&&!c.deletedAt).length >= MAX_CASES_PER_USER) fail(400,"Достигнут лимит дел");
    const title=String(b.title||"").trim().slice(0,160), objective=String(b.objective||"").trim().slice(0,1000);
    if (!title) fail(400,"Укажите название дела");
    const c={id:randomId(),ownerId:u.id,title,objective,summary:"",createdAt:now(),updatedAt:now()};
    store.db.cases.push(c);store.save();
    return json(res,201,{case:store.publicCase(c)});
  }
  const match = p.match(/^\/chat\/api\/cases\/([a-f0-9-]{36})(?:\/(documents|chat|compact))?(?:\/([a-f0-9-]{36}))?$/);
  if (!match) fail(404,"Ресурс не найден");
  const id=match[1], action=match[2], subId=match[3];
  const {u,c}=ownedCase(req,id);

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
    c.deletedAt=now();c.summary="";store.save();
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
    if(activeModelRequests.has(u.id))fail(429,"Другой запрос уже обрабатывается. Дождитесь ответа");
    activeModelRequests.add(u.id);
    try {
    const history=store.db.messages.filter(m=>m.caseId===id);
    const first=await askModel(baseRequest(c,history,message,docs,mode,balanceOf(u)!==null));
    let result=first;
    if (["strategy","review"].includes(mode) && process.env.SECOND_PASS_ENABLED!=="0") {
      // An actual separate skeptical review, not a claim that one was conducted.
      const critique = await askModel({
        model:MODEL,store:false,max_output_tokens:balanceOf(u)!==null?3000:4500,reasoning:{effort:"medium"},
        instructions:"Ты независимый юридический ревизор Республики Казахстан. Найди фактические, доказательственные, процессуальные и нормативные ошибки. Не придумывай нормы и не подтверждай их без источников. Дай ИСПРАВЛЕННУЮ окончательную позицию, сохрани сильные аргументы, укажи степень достоверности.",
        input:`Задача клиента: ${message}\nКарточка дела: ${c.title} / ${c.objective}; контекст: ${(c.summary||"").slice(0,7000)}\nПервоначальный ответ: ${first.text}\nСделай независимую проверку и напиши итоговый ответ.`,
      });
      result={text:critique.text,sources:[...first.sources,...critique.sources.filter(s=>!first.sources.some(t=>t.url===s.url))]};
    }
    const time=now();
    store.db.messages.push({id:randomId(),caseId:id,role:"user",text:message,mode,createdAt:time});
    store.db.messages.push({id:randomId(),caseId:id,role:"assistant",text:result.text,sources:result.sources,mode,createdAt:now()});
    c.updatedAt=now();completeCreditOperation(u,cost);store.save();
    return json(res,200,{answer:result.text,sources:result.sources,cost,...profile(u),rechecked:["strategy","review"].includes(mode)&&process.env.SECOND_PASS_ENABLED!=="0"});
    } finally {activeModelRequests.delete(u.id);}
  }
  if (req.method==="POST" && action==="compact") {
    const cost=aiTokenCost("compact");
    verifyCreditAccess(u,cost);
    if(activeModelRequests.has(u.id))fail(429,"Другой запрос уже обрабатывается. Дождитесь ответа");
    const messages=store.db.messages.filter(m=>m.caseId===id).slice(balanceOf(u)!==null?-25:-80);
    if(!messages.length) fail(400,"В деле пока нет сообщений");
    activeModelRequests.add(u.id);
    try {
    const digest=await askModel({
      model:MODEL,store:false,max_output_tokens:balanceOf(u)!==null?2400:3600,
      instructions:"Создай обновлённую структурированную, нейтральную карточку юридического дела на русском. Не выдумывай факты. Сохрани старые версии и противоречия, укажи источники если даны. Структура: ЦЕЛЬ; СТОРОНЫ; ДОКУМЕНТЫ; ХРОНОЛОГИЯ; ДОКАЗАННЫЕ ФАКТЫ; УТВЕРЖДЕНИЯ; ГИПОТЕЗЫ; ПРОТИВОРЕЧИЯ; НЕХВАТКА ДОКАЗАТЕЛЬСТВ; СРОКИ; ПРОЦЕССУАЛЬНЫЕ ВАРИАНТЫ; РИСКИ; СЛЕДУЮЩИЙ ШАГ. Никогда не выдавай гипотезу за факт.",
      input:`Название: ${c.title}\nЦель: ${c.objective}\nПрежняя карточка:\n${c.summary}\nИстория:\n${messages.map(m=>m.role+": "+m.text).join("\n\n").slice(-85000)}`,
    });
    c.summary=digest.text.slice(0,30000);c.updatedAt=now();completeCreditOperation(u,cost);store.save();
    return json(res,200,{summary:c.summary,cost,...profile(u)});
    } finally {activeModelRequests.delete(u.id);}
  }
  fail(404,"Неподдерживаемое действие");
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
        referralCode,referralSource:safeSource(url.searchParams.get("src"))
      });
      res.writeHead(302,{"location":flow.url,"set-cookie":flow.cookie,"cache-control":"no-store"});
      return res.end();
    }
    if(req.method==="GET"&&url.pathname==="/chat/auth/google/callback"){
      if(!googleEnabled())fail(503,"Вход через Google пока не подключён");
      try{
        const flow=verifyGoogleCookie(cookies(req).al_google_state,KEY);
        const state=url.searchParams.get("state");
        if(!state||state.length!==flow.state.length||
           !crypto.timingSafeEqual(Buffer.from(state),Buffer.from(flow.state)))
          throw Error("OAuth state mismatch");
        if(url.searchParams.has("error"))throw Error("Google authentication declined");
        const identity=await googleIdentity(url.searchParams.get("code"),flow,ORIGIN);
        let user, registered=false;
        if(flow.linkUserId){
          const validSession=store.db.sessions.some(x=>x.userId===flow.linkUserId&&
            x.hash===flow.linkSessionHash&&x.expiresAt>Date.now());
          if(!validSession)throw Error("Link session expired");
          user=store.db.users.find(x=>x.id===flow.linkUserId);
          if(!user||user.email!==identity.email||user.googleSub&&user.googleSub!==identity.sub)
            throw Error("Google linking email mismatch");
          if(store.db.users.some(x=>x.googleSub===identity.sub&&x.id!==user.id))
            throw Error("Google identity already linked");
          user.googleSub=identity.sub;user.emailVerified=true;store.save();
        }else{
          user=store.db.users.find(x=>x.googleSub===identity.sub);
          if(!user){
            if(store.db.users.some(x=>x.email===identity.email)) {
              res.writeHead(303,{"location":ORIGIN+"/chat/?auth_error=google_link_required",
                "set-cookie":clearGoogleCookie(ORIGIN.startsWith("https:"))});
              return res.end();
            }
            if(process.env.GOOGLE_SIGNUP_ENABLED!=="1")throw Error("New Google registration not enabled");
            ensureGuestIdle(req);
            const grant=allocateVerifiedRegistration(store.db,flow.referralCode);
            user={id:randomId(),email:identity.email,pass:null,googleSub:identity.sub,
              emailVerified:true,createdAt:now(),credits:grant.credits,
              accountType:"trial",referralCode:grant.referralCode,
              referralSource:flow.referralSource||null};
            store.db.users.push(user);saveGuestConversation(req,user);store.save();
            registered=true;
          }
        }
        newSession(user,res,flow.remember);
        const set=res.getHeader("set-cookie");
        res.setHeader("set-cookie",[set,clearGoogleCookie(ORIGIN.startsWith("https:"))]);
        const notice=flow.linkUserId?"?auth_notice=google_linked":registered?"?auth_notice=google_registered":"";
        res.writeHead(303,{"location":ORIGIN+"/chat/"+notice});
        return res.end();
      }catch{
        res.writeHead(303,{"location":ORIGIN+"/chat/?auth_error=google_login_failed",
          "set-cookie":clearGoogleCookie(ORIGIN.startsWith("https:"))});
        return res.end();
      }
    }
    if(req.method!=="GET" && !["POST","PATCH","DELETE"].includes(req.method)) fail(405,"Метод не поддерживается");
    if(req.method!=="GET") sameOrigin(req);
    const exportMatch=url.pathname.match(new RegExp("^/chat/api/cases/([a-f0-9-]{36})/export/([a-f0-9-]{36})$"));
    if(req.method==="GET" && exportMatch) {
      const {c}=ownedCase(req,exportMatch[1]);
      const message=store.db.messages.find(m=>m.caseId===c.id && m.id===exportMatch[2] && m.role==="assistant");
      if(!message) fail(404,"Ответ не найден в этом деле");
      const format=url.searchParams.get("format");
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
