import http from "node:http";
import {randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {adminAuthorized,balanceOf,displayTokens,PUBLIC_TOKEN_MULTIPLIER} from "./referrals.mjs";
import {sumEstimatedProviderCost} from "./pricing.mjs";

const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=n=>Number(n||0).toLocaleString("ru-RU");
const usd=n=>"$"+Number(n||0).toFixed(4);
const date=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString().slice(0,10):"—";

export function adminSummary(db,at=Date.now()){
  const users=db.users||[],orders=db.paymentOrders||[],usage=db.providerUsage||[];
  const paid=orders.filter(o=>o.status==="paid");
  const recent=usage.filter(x=>Date.parse(x.at)>=at-86400000);
  return {users:users.length,trial:users.filter(u=>u.accountType==="trial").length,
    paidAccounts:users.filter(u=>u.accountType==="paid").length,
    orders:orders.length,paidOrders:paid.length,pendingOrders:orders.filter(o=>o.status==="pending").length,
    grossKzt:paid.reduce((s,o)=>s+(Number.isSafeInteger(o.amountMinor)?o.amountMinor:0),0)/100,
    cost24h:sumEstimatedProviderCost(recent),costAll:sumEstimatedProviderCost(usage),
    freeCost:sumEstimatedProviderCost(usage,true)};
}
export function adminAuthorizedRequest(req,secret){
  if(!/^(127\.0\.0\.1|localhost)(:[0-9]{1,5})?$/i.test(req.headers.host||""))return false;
  if(req.headers["sec-fetch-site"]==="cross-site"||req.headers["x-forwarded-for"]||req.headers["x-real-ip"])return false;
  const raw=req.headers.authorization||"";
  if(!/^Basic [A-Za-z0-9+/=]{1,160}$/.test(raw))return false;
  const decoded=Buffer.from(raw.slice(6),"base64").toString("utf8");
  if(!decoded.startsWith("admin:"))return false;
  return adminAuthorized(req.socket.remoteAddress,decoded.slice(6),secret);
}
// Promotional grants never create a paid order or mark an account as paid.
export function grantBonus(store,{userId,tokens,reason,requestId}){
  const user=store.db.users.find(u=>u.id===userId);
  if(!user||!["trial","paid"].includes(user.accountType)||balanceOf(user)===null)
    throw Error("Недопустимый аккаунт");
  if(!Number.isSafeInteger(tokens)||tokens<100||tokens>200000||tokens%PUBLIC_TOKEN_MULTIPLIER!==0)
    throw Error("Введите от 100 до 200 000 токенов, кратно 100");
  if(typeof reason!=="string"||reason.trim().length<3||reason.trim().length>160)
    throw Error("Укажите причину (3–160 символов)");
  if(typeof requestId!=="string"||! /^[a-f0-9-]{36}$/.test(requestId))
    throw Error("Недопустимый идентификатор операции");
  reason=reason.trim();
  const old=store.db.adminBonusGrants;
  const existing=(old||[]).find(x=>x.requestId===requestId);
  if(existing){
    if(existing.userId!==userId||existing.tokens!==tokens||existing.reason!==reason)
      throw Error("Конфликт идентификатора операции");
    return {granted:false,balance:displayTokens(user.credits)};
  }
  const credits=user.credits;
  const next=credits+tokens/PUBLIC_TOKEN_MULTIPLIER;
  if(!Number.isSafeInteger(next*PUBLIC_TOKEN_MULTIPLIER))throw Error("Недопустимый баланс");
  user.credits=next;
  store.db.adminBonusGrants=[...(old||[]),{requestId,userId,tokens,reason,at:new Date().toISOString(),actor:"admin"}];
  try{store.save();}catch(e){
    user.credits=credits;
    if(old===undefined)delete store.db.adminBonusGrants;else store.db.adminBonusGrants=old;
    throw e;
  }
  return {granted:true,balance:displayTokens(user.credits)};
}
export function changeAccountAccess(store,{userId,action,reason,requestId},isBusy=()=>false){
  const u=store.db.users.find(x=>x.id===userId);
  if(!u||!["trial","paid"].includes(u.accountType))throw Error("Invalid account");
  if(!["block","unblock"].includes(action)||typeof reason!=="string"||
     reason.trim().length<3||reason.trim().length>160||
     typeof requestId!=="string"||! /^[a-f0-9-]{36}$/.test(requestId))throw Error("Invalid action");
  reason=reason.trim();
  const before=store.db.adminAccessLog;
  const existing=(before||[]).find(x=>x.requestId===requestId);
  if(existing){
    if(existing.userId!==userId||existing.action!==action||existing.reason!==reason)throw Error("Conflicting request");
    return {changed:false};
  }
  const blocked=action==="block";
  if(Boolean(u.blockedAt)===blocked)return {changed:false};
  if(isBusy(u.id))throw Error("Account request in progress");
  const prior=u.blockedAt,had=Object.hasOwn(u,"blockedAt"),sessions=store.db.sessions;
  if(blocked)u.blockedAt=new Date().toISOString();else delete u.blockedAt;
  store.db.sessions=sessions.filter(x=>x.userId!==u.id);
  store.db.adminAccessLog=[...(before||[]),{requestId,userId,action,reason,at:new Date().toISOString(),actor:"admin"}];
  try{store.save();}catch(e){
    if(had)u.blockedAt=prior;else delete u.blockedAt;
    store.db.sessions=sessions;
    if(before===undefined)delete store.db.adminAccessLog;else store.db.adminAccessLog=before;
    throw e;
  }
  return {changed:true};
}
function accessForm(user,csrf){
  if(!csrf||!["trial","paid"].includes(user.accountType))return "";
  const action=user.blockedAt?"unblock":"block";
  return '<details><summary>'+(user.blockedAt?"Разблокировать":"Заблокировать")+'</summary><form method="post" action="/access">'+
    '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
    '<input type="hidden" name="requestId" value="'+randomUUID()+'">'+
    '<input type="hidden" name="userId" value="'+escapeHtml(user.id)+'">'+
    '<input type="hidden" name="action" value="'+action+'">'+
    '<label>Причина <input name="reason" minlength="3" maxlength="160" required placeholder="Без личных данных"></label>'+
    '<button type="submit">Подтвердить</button></form></details>';
}
function grantForm(user,csrf){
  if(!csrf||balanceOf(user)===null||!["trial","paid"].includes(user.accountType))return "—";
  return '<details><summary>Начислить бонус</summary><form method="post" action="/bonus">'+
    '<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">'+
    '<input type="hidden" name="requestId" value="'+randomUUID()+'">'+
    '<input type="hidden" name="userId" value="'+escapeHtml(user.id)+'">'+
    '<label>Токены <input type="number" name="tokens" min="100" max="200000" step="100" required></label>'+
    '<label>Причина <input name="reason" minlength="3" maxlength="160" required placeholder="Без личных данных"></label>'+
    '<button type="submit">Подтвердить начисление</button></form></details>';
}
export function renderAdmin(db,{query="",page=1,enabled=false,at=Date.now(),csrf="",notice=""}={}){
  const s=adminSummary(db,at),q=String(query).trim().slice(0,120).toLowerCase();
  const matching=(db.users||[]).filter(u=>!q||String(u.email||"").toLowerCase().includes(q)||String(u.id||"").toLowerCase().includes(q));
  const maxPage=Math.max(1,Math.ceil(matching.length/50));
  page=Math.min(maxPage,Math.max(1,Number.isSafeInteger(page)?page:1));
  const usageByUser=new Map();
  for(const x of db.providerUsage||[]){if(x.userId)usageByUser.set(x.userId,(usageByUser.get(x.userId)||0)+(Number(x.estimatedUsd)||0));}
  const rows=matching.slice().reverse().slice((page-1)*50,page*50).map(u=>{
    const bal=balanceOf(u);
    return "<tr><td>"+escapeHtml(u.email)+"</td><td>"+escapeHtml(u.accountType||"legacy")+(u.blockedAt?" (заблокирован)":"")+"</td><td>"+
      (bal===null?"—":num(displayTokens(bal)))+"</td><td>"+date(u.createdAt)+"</td><td>"+usd(usageByUser.get(u.id))+"</td><td>"+grantForm(u,csrf)+accessForm(u,csrf)+"</td></tr>";
  }).join("");
  const orders=(db.paymentOrders||[]).slice().reverse().slice(0,100).map(o=>"<tr><td>"+escapeHtml(o.id)+"</td><td>"+escapeHtml(o.packageName)+"</td><td>"+num(o.amountMinor/100)+" ₸</td><td>"+escapeHtml(o.provider)+"</td><td>"+escapeHtml(o.status)+"</td><td>"+date(o.createdAt)+"</td></tr>").join("");
  const tiles=[["Пользователи",num(s.users)],["Пробные аккаунты",num(s.trial)],["Платные аккаунты",num(s.paidAccounts)],
    ["Оплаченные заказы",num(s.paidOrders)],["Ожидают оплаты",num(s.pendingOrders)],["Подтвержденные оплаты",num(s.grossKzt)+" ₸"],
    ["API: 24 часа",usd(s.cost24h)],["API: весь учтенный период",usd(s.costAll)],["API: бесплатный доступ",usd(s.freeCost)]]
    .map(([label,value])=>"<article><small>"+label+"</small><strong>"+value+"</strong></article>").join("");
  const href=p=>"/?q="+encodeURIComponent(q)+"&amp;page="+p;
  const emails=new Map((db.users||[]).map(u=>[u.id,u.email]));
  const accessAudit=(db.adminAccessLog||[]).slice(-50).reverse().map(x=>"<tr><td>"+escapeHtml(emails.get(x.userId)||x.userId)+"</td><td>"+(x.action==="block"?"Блокировка":"Разблокировка")+"</td><td>"+escapeHtml(x.reason)+"</td><td>"+escapeHtml(x.at)+"</td></tr>").join("");
  const audit=(db.adminBonusGrants||[]).slice(-50).reverse().map(x=>"<tr><td>"+escapeHtml(emails.get(x.userId)||x.userId)+"</td><td>"+num(x.tokens)+"</td><td>"+escapeHtml(x.reason)+"</td><td>"+escapeHtml(x.at)+"</td></tr>").join("");
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Lawyer — администрирование</title><style>body{font:15px system-ui,sans-serif;color:#203047;background:#f5f7fa;margin:0;padding:24px}main{max-width:1200px;margin:auto}h1{font-size:25px}h2{font-size:19px;margin-top:28px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}article{padding:16px;background:white;border:1px solid #dce3eb;border-radius:8px}strong{display:block;font-size:22px;margin-top:8px}.table{overflow:auto;background:white;border:1px solid #dce3eb;border-radius:8px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #e5e9ef;white-space:nowrap}input,button{font:inherit;padding:8px}a{color:#235e96}small,p{color:#526174}</style></head><body><main><h1>AI Lawyer Kazakhstan — администрирование</h1><p>Закрытая панель. Ручные начисления — только бесплатные бонусы. Оплата: '+(enabled?"включена":"отключена")+'. <a href="/">Обновить</a></p><p role="status">'+escapeHtml(notice)+'</p><section class="tiles">'+tiles+'</section><p>Суммы API — расчётные по сохраненным данным usage, не банковский баланс и не окончательный счет OpenAI. Оплаты — валовая сумма записей со статусом paid, не чистая прибыль.</p><h2>Пользователи</h2><form method="get" action="/"><input name="q" maxlength="120" placeholder="Email или ID" value="'+escapeHtml(q)+'"><button>Найти</button></form><p>Найдено: '+num(matching.length)+' · Страница '+page+' / '+maxPage+(page>1?' · <a href="'+href(page-1)+'">Назад</a>':'')+(page<maxPage?' · <a href="'+href(page+1)+'">Далее</a>':'')+'</p><div class="table"><table><thead><tr><th>Email</th><th>Тип</th><th>Токены</th><th>Регистрация (UTC)</th><th>Учтенные расходы API</th><th>Действия</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6">Нет записей</td></tr>')+'</tbody></table></div><h2>Последние 50 бонусных начислений</h2><div class="table"><table><thead><tr><th>Аккаунт</th><th>Токены</th><th>Причина</th><th>Время (UTC)</th></tr></thead><tbody>'+(audit||'<tr><td colspan="4">Нет начислений</td></tr>')+'</tbody></table></div><h2>Последние 50 изменений доступа</h2><div class="table"><table><thead><tr><th>Аккаунт</th><th>Действие</th><th>Причина</th><th>Время (UTC)</th></tr></thead><tbody>'+(accessAudit||'<tr><td colspan="4">Нет изменений</td></tr>')+'</tbody></table></div><h2>Последние 100 заказов</h2><div class="table"><table><thead><tr><th>Заказ</th><th>Пакет</th><th>Сумма</th><th>Провайдер</th><th>Статус</th><th>Дата (UTC)</th></tr></thead><tbody>'+(orders||'<tr><td colspan="6">Нет заказов</td></tr>')+'</tbody></table></div></main></body></html>';
}
export function createAdminDashboard(store,{secret,enabled=false,isBusy=()=>false}={}){
  if(!/^[a-f0-9]{64}$/i.test(String(secret||"")))throw Error("Admin dashboard key not configured");
  const csrf=randomBytes(32).toString("hex");
  return http.createServer(async(req,res)=>{
    res.setHeader("cache-control","no-store");
    res.setHeader("x-content-type-options","nosniff");
    res.setHeader("x-frame-options","DENY");
    res.setHeader("referrer-policy","same-origin");
    res.setHeader("content-security-policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if(!adminAuthorizedRequest(req,secret)){
      res.writeHead(401,{"www-authenticate":'Basic realm="AI Lawyer Admin", charset="UTF-8"'});
      return res.end("Unauthorized");
    }
    const url=new URL(req.url,"http://127.0.0.1");
    if(req.method==="POST"&&["/bonus","/access"].includes(url.pathname)){
      if(req.headers.origin!=="http://"+req.headers.host||
         (req.headers["sec-fetch-site"]&&req.headers["sec-fetch-site"]!=="same-origin")){
        res.writeHead(403);return res.end("Forbidden origin");
      }
      if(!String(req.headers["content-type"]||"").toLowerCase().startsWith("application/x-www-form-urlencoded")){
        res.writeHead(415);return res.end("Unsupported content type");
      }
      try{
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413);res.end("Too large");return;}chunks.push(chunk);}
        const body=new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const supplied=body.get("csrf")||"";
        if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied,"hex"),Buffer.from(csrf,"hex"))){
          res.writeHead(403);return res.end("Invalid CSRF token");
        }
        if(url.pathname==="/access"){
          const result=changeAccountAccess(store,{userId:body.get("userId"),action:body.get("action"),reason:body.get("reason"),requestId:body.get("requestId")},isBusy);
          res.writeHead(303,{location:"/?result="+(result.changed?"accessChanged":"accessUnchanged")});return res.end();
        }
        const result=grantBonus(store,{userId:body.get("userId"),tokens:Number(body.get("tokens")),reason:body.get("reason"),requestId:body.get("requestId")});
        res.writeHead(303,{location:"/?result="+(result.granted?"granted":"duplicate")});return res.end();
      }catch(e){
        res.writeHead(400,{"content-type":"text/plain; charset=utf-8"});
        return res.end("Операция не выполнена. Проверьте данные или дождитесь завершения запроса пользователя. Вернитесь к панели.");
      }
    }
    if(req.method!=="GET"){res.writeHead(405,{"allow":"GET"});return res.end("Method not allowed");}
    if(url.pathname!=="/"){res.writeHead(404);return res.end("Not found");}
    try{const html=renderAdmin(store.db,{query:url.searchParams.get("q")||"",page:Number(url.searchParams.get("page")||1),enabled,csrf,notice:({granted:"Бонус начислен.",duplicate:"Начисление уже выполнено.",accessChanged:"Доступ изменён. Старые сеансы завершены.",accessUnchanged:"Доступ уже имеет выбранное состояние."})[url.searchParams.get("result")]||""});
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(html);
    }catch{res.writeHead(500);res.end("Dashboard unavailable");}
  });
}
