import http from "node:http";
import {adminAuthorized,balanceOf,displayTokens} from "./referrals.mjs";
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
export function renderAdmin(db,{query="",page=1,enabled=false,at=Date.now()}={}){
  const s=adminSummary(db,at),q=String(query).trim().slice(0,120).toLowerCase();
  const matching=(db.users||[]).filter(u=>!q||String(u.email||"").toLowerCase().includes(q)||String(u.id||"").toLowerCase().includes(q));
  const maxPage=Math.max(1,Math.ceil(matching.length/50));
  page=Math.min(maxPage,Math.max(1,Number.isSafeInteger(page)?page:1));
  const usageByUser=new Map();
  for(const x of db.providerUsage||[]){if(x.userId)usageByUser.set(x.userId,(usageByUser.get(x.userId)||0)+(Number(x.estimatedUsd)||0));}
  const rows=matching.slice().reverse().slice((page-1)*50,page*50).map(u=>{
    const bal=balanceOf(u);
    return "<tr><td>"+escapeHtml(u.email)+"</td><td>"+escapeHtml(u.accountType||"legacy")+"</td><td>"+
      (bal===null?"—":num(displayTokens(bal)))+"</td><td>"+date(u.createdAt)+"</td><td>"+usd(usageByUser.get(u.id))+"</td></tr>";
  }).join("");
  const orders=(db.paymentOrders||[]).slice().reverse().slice(0,100).map(o=>"<tr><td>"+escapeHtml(o.id)+"</td><td>"+escapeHtml(o.packageName)+"</td><td>"+num(o.amountMinor/100)+" ₸</td><td>"+escapeHtml(o.provider)+"</td><td>"+escapeHtml(o.status)+"</td><td>"+date(o.createdAt)+"</td></tr>").join("");
  const tiles=[["Пользователи",num(s.users)],["Пробные аккаунты",num(s.trial)],["Платные аккаунты",num(s.paidAccounts)],
    ["Оплаченные заказы",num(s.paidOrders)],["Ожидают оплаты",num(s.pendingOrders)],["Подтвержденные оплаты",num(s.grossKzt)+" ₸"],
    ["API: 24 часа",usd(s.cost24h)],["API: весь учтенный период",usd(s.costAll)],["API: бесплатный доступ",usd(s.freeCost)]]
    .map(([label,value])=>"<article><small>"+label+"</small><strong>"+value+"</strong></article>").join("");
  const href=p=>"/?q="+encodeURIComponent(q)+"&amp;page="+p;
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Lawyer — администрирование</title><style>body{font:15px system-ui,sans-serif;color:#203047;background:#f5f7fa;margin:0;padding:24px}main{max-width:1200px;margin:auto}h1{font-size:25px}h2{font-size:19px;margin-top:28px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}article{padding:16px;background:white;border:1px solid #dce3eb;border-radius:8px}strong{display:block;font-size:22px;margin-top:8px}.table{overflow:auto;background:white;border:1px solid #dce3eb;border-radius:8px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #e5e9ef;white-space:nowrap}input,button{font:inherit;padding:8px}a{color:#235e96}small,p{color:#526174}</style></head><body><main><h1>AI Lawyer Kazakhstan — администрирование</h1><p>Закрытая панель, только чтение. Оплата: '+(enabled?"включена":"отключена")+'. <a href="/">Обновить</a></p><section class="tiles">'+tiles+'</section><p>Суммы API — расчётные по сохраненным данным usage, не банковский баланс и не окончательный счет OpenAI. Оплаты — валовая сумма записей со статусом paid, не чистая прибыль.</p><h2>Пользователи</h2><form method="get" action="/"><input name="q" maxlength="120" placeholder="Email или ID" value="'+escapeHtml(q)+'"><button>Найти</button></form><p>Найдено: '+num(matching.length)+' · Страница '+page+' / '+maxPage+(page>1?' · <a href="'+href(page-1)+'">Назад</a>':'')+(page<maxPage?' · <a href="'+href(page+1)+'">Далее</a>':'')+'</p><div class="table"><table><thead><tr><th>Email</th><th>Тип</th><th>Токены</th><th>Регистрация (UTC)</th><th>Учтенные расходы API</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5">Нет записей</td></tr>')+'</tbody></table></div><h2>Последние 100 заказов</h2><div class="table"><table><thead><tr><th>Заказ</th><th>Пакет</th><th>Сумма</th><th>Провайдер</th><th>Статус</th><th>Дата (UTC)</th></tr></thead><tbody>'+(orders||'<tr><td colspan="6">Нет заказов</td></tr>')+'</tbody></table></div></main></body></html>';
}
export function createAdminDashboard(store,{secret,enabled=false}={}){
  if(!/^[a-f0-9]{64}$/i.test(String(secret||"")))throw Error("Admin dashboard key not configured");
  return http.createServer((req,res)=>{
    res.setHeader("cache-control","no-store");
    res.setHeader("x-content-type-options","nosniff");
    res.setHeader("x-frame-options","DENY");
    res.setHeader("referrer-policy","no-referrer");
    res.setHeader("content-security-policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if(!adminAuthorizedRequest(req,secret)){
      res.writeHead(401,{"www-authenticate":'Basic realm="AI Lawyer Admin", charset="UTF-8"'});
      return res.end("Unauthorized");
    }
    if(req.method!=="GET"){res.writeHead(405,{"allow":"GET"});return res.end("Read only");}
    const url=new URL(req.url,"http://127.0.0.1");
    if(url.pathname!=="/"){res.writeHead(404);return res.end("Not found");}
    try{const html=renderAdmin(store.db,{query:url.searchParams.get("q")||"",page:Number(url.searchParams.get("page")||1),enabled});
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(html);
    }catch{res.writeHead(500);res.end("Dashboard unavailable");}
  });
}
