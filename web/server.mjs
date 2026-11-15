import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
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
const throttle = new Map();
const now = () => new Date().toISOString();

const HTML = fs.readFileSync(path.join(dirname, "public", "index.html"));
const JS = fs.readFileSync(path.join(dirname, "public", "app.js"));
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
  return `al_session=${token}; HttpOnly; SameSite=Strict; Path=/chat/; Max-Age=${maxAge}${secure}`;
}
function newSession(user, res) {
  const token = crypto.randomBytes(32).toString("hex"), expiresAt = Date.now() + 7 * 86400000;
  store.db.sessions.push({ hash:tokenHash(token), userId:user.id, expiresAt });
  store.db.sessions = store.db.sessions.filter(s => s.expiresAt > Date.now());
  store.save();
  res.setHeader("set-cookie", sessionCookie(token, 7 * 86400));
}
function safeUser(u) { return { id:u.id, email:u.email }; }
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
function baseRequest(caseData, history, message, docs, mode) {
  const input = buildMessages(history, message, docs, { ...caseData, mode });
  return {
    model:MODEL, store:false, instructions:strategyInstruction(strategy + "\n\n" + playbooks,mode),
    reasoning:{ effort:"medium" }, max_output_tokens:6500,
    ...(SEARCH_ENABLED ? { tools:[{ type:"web_search", search_context_size:"medium", filters:{ allowed_domains:["adilet.zan.kz","zan.gov.kz","gov.kz","sud.gov.kz","egov.kz"] } }] } : {}),
    input,
  };
}
function countToday(userId) {
  const date = new Date().toISOString().slice(0,10);
  return store.db.usage.filter(u => u.userId === userId && u.date === date).reduce((n,u)=>n+u.count,0);
}
function charge(userId) {
  const date = new Date().toISOString().slice(0,10);
  const usage = store.db.usage.find(x=>x.userId === userId && x.date === date);
  if (usage) usage.count++; else store.db.usage.push({userId,date,count:1});
  store.db.usage = store.db.usage.filter(u => u.date >= new Date(Date.now()-14*86400000).toISOString().slice(0,10));
}

async function api(req,res,url) {
  const p = url.pathname;
  if (req.method === "GET" && p === "/chat/api/session") {
    const user = sessionFor(req);
    return json(res,200,{ authenticated:!!user, user:user?safeUser(user):null, configured:!!process.env.OPENAI_API_KEY, dailyLimit:DAILY_LIMIT });
  }
  if (req.method === "POST" && p === "/chat/api/auth/register") {
    rateLimit(req,"auth",8,15*60000);
    const b = await bodyJson(req), email = validateEmail(b.email);
    if (!process.env.SIGNUP_INVITE_CODE || b.invite !== process.env.SIGNUP_INVITE_CODE) fail(403,"Регистрация доступна только по приглашению");
    if (!email || !validPassword(b.password)) fail(400,"Нужны корректная почта и пароль не короче 12 символов");
    if (store.db.users.some(u=>u.email===email)) fail(409,"Адрес уже зарегистрирован");
    const u={id:randomId(), email, pass:hashPassword(b.password), createdAt:now()};
    store.db.users.push(u); store.save(); newSession(u,res);
    return json(res,201,{user:safeUser(u)});
  }
  if (req.method === "POST" && p === "/chat/api/auth/login") {
    rateLimit(req,"auth",8,15*60000);
    const b=await bodyJson(req), email=validateEmail(b.email);
    const user=store.db.users.find(u=>u.email===email);
    if (!user || !checkPassword(String(b.password||""),user.pass)) fail(401,"Неверная почта или пароль");
    newSession(user,res);
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
    return json(res,200,{cases,usedToday:countToday(u.id)});
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
    if(countToday(u.id)>=DAILY_LIMIT) fail(429,"На сегодня достигнут лимит сообщений");
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
    const history=store.db.messages.filter(m=>m.caseId===id);
    const first=await askModel(baseRequest(c,history,message,docs,mode));
    let result=first;
    if (["strategy","review"].includes(mode) && process.env.SECOND_PASS_ENABLED!=="0") {
      // An actual separate skeptical review, not a claim that one was conducted.
      const critique = await askModel({
        model:MODEL,store:false,max_output_tokens:4500,reasoning:{effort:"medium"},
        instructions:"Ты независимый юридический ревизор Республики Казахстан. Найди фактические, доказательственные, процессуальные и нормативные ошибки. Не придумывай нормы и не подтверждай их без источников. Дай ИСПРАВЛЕННУЮ окончательную позицию, сохрани сильные аргументы, укажи степень достоверности.",
        input:`Задача клиента: ${message}\nКарточка дела: ${c.title} / ${c.objective}; контекст: ${(c.summary||"").slice(0,7000)}\nПервоначальный ответ: ${first.text}\nСделай независимую проверку и напиши итоговый ответ.`,
      });
      result={text:critique.text,sources:[...first.sources,...critique.sources.filter(s=>!first.sources.some(t=>t.url===s.url))]};
    }
    const time=now();
    store.db.messages.push({id:randomId(),caseId:id,role:"user",text:message,mode,createdAt:time});
    store.db.messages.push({id:randomId(),caseId:id,role:"assistant",text:result.text,sources:result.sources,mode,createdAt:now()});
    c.updatedAt=now();charge(u.id);store.save();
    return json(res,200,{answer:result.text,sources:result.sources,usedToday:countToday(u.id),rechecked:["strategy","review"].includes(mode)&&process.env.SECOND_PASS_ENABLED!=="0"});
  }
  if (req.method==="POST" && action==="compact") {
    if(countToday(u.id)>=DAILY_LIMIT) fail(429,"На сегодня достигнут лимит");
    const messages=store.db.messages.filter(m=>m.caseId===id).slice(-80);
    if(!messages.length) fail(400,"В деле пока нет сообщений");
    const digest=await askModel({
      model:MODEL,store:false,max_output_tokens:3600,
      instructions:"Создай обновлённую структурированную, нейтральную карточку юридического дела на русском. Не выдумывай факты. Сохрани старые версии и противоречия, укажи источники если даны. Структура: ЦЕЛЬ; СТОРОНЫ; ДОКУМЕНТЫ; ХРОНОЛОГИЯ; ДОКАЗАННЫЕ ФАКТЫ; УТВЕРЖДЕНИЯ; ГИПОТЕЗЫ; ПРОТИВОРЕЧИЯ; НЕХВАТКА ДОКАЗАТЕЛЬСТВ; СРОКИ; ПРОЦЕССУАЛЬНЫЕ ВАРИАНТЫ; РИСКИ; СЛЕДУЮЩИЙ ШАГ. Никогда не выдавай гипотезу за факт.",
      input:`Название: ${c.title}\nЦель: ${c.objective}\nПрежняя карточка:\n${c.summary}\nИстория:\n${messages.map(m=>m.role+": "+m.text).join("\n\n").slice(-85000)}`,
    });
    c.summary=digest.text.slice(0,30000);c.updatedAt=now();charge(u.id);store.save();
    return json(res,200,{summary:c.summary,usedToday:countToday(u.id)});
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
    if(req.method==="GET" && url.pathname==="/chat/logo.svg"){
      res.writeHead(200,{"content-type":"image/svg+xml"});return res.end(logo);
    }
    if(req.method==="GET" && url.pathname==="/chat/health"){
      return json(res,200,{ok:true,configured:!!process.env.OPENAI_API_KEY});
    }
    if(req.method!=="GET" && !["POST","PATCH","DELETE"].includes(req.method)) fail(405,"Метод не поддерживается");
    if(req.method!=="GET") sameOrigin(req);
    if(!url.pathname.startsWith("/chat/api/")) fail(404,"Ресурс не найден");
    await api(req,res,url);
  } catch(e){
    const status=e.status || 500;
    if(status===500) console.error("internal_error",e.name,e.code||"");
    if(!res.headersSent) json(res,status,{error:status===500?"Внутренняя ошибка сервера":e.message});
    else res.end();
  }
});
server.listen(PORT,process.env.HOST||"127.0.0.1",()=>console.log("AI Lawyer web listening on",PORT));
