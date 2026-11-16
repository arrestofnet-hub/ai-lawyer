import { parseLegalMarkdown, inlineTokens, plainLegalText } from "./format.js";
const $ = (selector) => document.querySelector(selector);
function inlineInto(node,text) {
  for (const token of inlineTokens(text)) {
    if(token.kind==="text") {node.append(document.createTextNode(token.text));continue;}
    let child;
    if(token.kind==="strong") child=document.createElement("strong");
    else if(token.kind==="em") child=document.createElement("em");
    else if(token.kind==="code") child=document.createElement("code");
    else if(token.kind==="link") {
      child=document.createElement("a");
      try {
        const url=new URL(token.url);
        if(!["https:","http:"].includes(url.protocol)) throw Error("Unsafe URL");
        child.href=url.href;child.target="_blank";child.rel="noopener noreferrer";
      } catch {node.append(document.createTextNode(token.text));continue;}
    } else {node.append(document.createTextNode(token.text));continue;}
    child.textContent=token.text;node.append(child);
  }
}
function formattedAnswer(text) {
  const wrap=document.createElement("div");wrap.className="rendered";
  for(const block of parseLegalMarkdown(text)) {
    let el;
    if(block.kind==="table") {
      el=document.createElement("div");el.className="legal-table-wrap";
      const table=document.createElement("table");
      const header=document.createElement("tr");
      for(const value of block.headers){
        const th=document.createElement("th");th.textContent=value;header.append(th);
      }
      table.append(header);
      for(const row of block.rows) {
        const tr=document.createElement("tr");
        for(let j=0;j<block.headers.length;j++) {
          const td=document.createElement("td");td.textContent=row[j]||"";tr.append(td);
        }
        table.append(tr);
      }
      el.append(table);
    } else if(block.kind==="ordered"||block.kind==="bullets") {
      el=document.createElement(block.kind==="ordered"?"ol":"ul");
      for(const item of block.items) {const li=document.createElement("li");inlineInto(li,item);el.append(li);}
    } else if(block.kind==="heading") {
      el=document.createElement("h"+Math.min(4,block.level));
      el.textContent=block.text;
    } else if(block.kind==="code") {
      el=document.createElement("pre");el.textContent=block.text;
    } else if(block.kind==="quote") {
      el=document.createElement("blockquote");inlineInto(el,block.text);
    } else {
      el=document.createElement("p");inlineInto(el,block.text);
    }
    wrap.append(el);
  }
  return wrap;
}
async function downloadExport(caseId,messageId,format,button) {
  const original=button.textContent;button.disabled=true;button.textContent="Создаём...";
  try {
    const response=await fetch(API+"/cases/"+encodeURIComponent(caseId)+"/export/"+encodeURIComponent(messageId)+"?format="+encodeURIComponent(format),{
      credentials:"same-origin",cache:"no-store"
    });
    if(!response.ok){
      const err=await response.json().catch(()=>({}));
      throw Error(err.error||"Не удалось создать файл");
    }
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;
    a.download="ai-lawyer-"+messageId.slice(0,8)+"."+format;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  } catch(e) {showError(e.message);}
  finally {button.disabled=false;button.textContent=original;}
}
const state = { user:null, cases:[], current:null, mode:"consult", docIds:new Set(),
  busy:false, registered:false, awaitingCode:false, signupMode:"invite",
  legacyInviteVisible:false, googleEnabled:false, dailyLimit:0,balance:null,
  prices:{consult:1,audit:6,strategy:8,draft:6,review:8,compact:2}
};
const incomingParams=new URLSearchParams(location.search);
const referralFromLink=(incomingParams.get("ref")||"").trim().toUpperCase().slice(0,20);
const sourceFromLink=(incomingParams.get("utm_source")||"").replace(/[^a-zA-Z0-9_.-]/g,"").slice(0,60);

const API = "/chat/api";
const MODE_HELP = {
  consult:"Консультация — предварительный разбор и ближайшее действие",
  audit:"Противоречия — сопоставление документов, дат, сумм и позиций сторон",
  strategy:"Стратегия — процессуальные варианты, риски и вторая проверка модели",
  draft:"Документ — проект для копирования и выгрузки Word/PDF",
  review:"Перепроверка — независимая проверка выводов второй моделью",
};
function updateSelectedCount() {
  const count=state.docIds.size;
  $("#selectedCount").textContent=count
    ? "Выбрано файлов: " + count + " / 3"
    : "Файлы не выбраны";
  updateModeHint();
}

function showError(message, target="#notice") {
  const el=$(target); if(el) { el.textContent=String(message); el.style.color="#ac3434"; }
}
function clearError(target="#notice") {
  const el=$(target); if(el) { el.textContent="AI может ошибаться. Проверяйте нормы, сроки и документы."; el.style.color=""; }
}
async function request(route, options={}) {
  const res=await fetch(API+route,{credentials:"same-origin",cache:"no-store",...options,
    headers:{...(options.body && !(options.body instanceof Blob) ? {"content-type":"application/json"} : {}),...(options.headers||{})}});
  const data=await res.json().catch(()=>({error:"Некорректный ответ сервера"}));
  if(!res.ok) throw new Error(data.error||"Ошибка сервера");
  return data;
}
const post=(route,body)=>request(route,{method:"POST",body:JSON.stringify(body)});
function authView(isAuthed) {
  $("#authScreen").style.display=isAuthed?"none":"grid";
  $("#app").style.display=isAuthed?"grid":"none";
}
function updateAuthUi() {
  const registration=state.registered;
  const requiresCode=state.awaitingCode;
  const legacy=registration&&state.signupMode==="invite"&&!requiresCode;
  $("#referralWrap").hidden=!registration||requiresCode;
  $("#legacyInviteToggle").hidden=!legacy;
  $("#legacyInviteToggle").textContent=state.legacyInviteVisible
    ?"Скрыть поле тестового кода":"Есть тестовый код доступа";
  $("#invite").hidden=!legacy||!state.legacyInviteVisible;
  $("#invite").required=legacy&&state.legacyInviteVisible;
  $("#verifyCode").hidden=!requiresCode;
  $("#verifyCode").required=requiresCode;
  $("#password").hidden=requiresCode;
  $("#password").required=!requiresCode;
  $("#password").autocomplete=registration?"new-password":"current-password";
  $("#authSubmit").textContent=requiresCode?"Подтвердить email":registration?"Зарегистрироваться":"Войти";
  // Until the SMTP mailbox is configured, registration stays invite-only.
  $("#authSubmit").disabled=legacy&&!state.legacyInviteVisible;
  $("#toggleRegister").textContent=registration?"У меня уже есть аккаунт":"Зарегистрироваться по email";
  $("#toggleRegister").disabled=state.signupMode==="disabled"&&!registration;
  $("#googleLogin").disabled=!state.googleEnabled;
  $("#googleLogin").title=state.googleEnabled?"Вход через аккаунт Google":"Нужно подключить Google OAuth в настройках сервера";
  $("#authHelp").textContent=requiresCode
    ?"Введите шестизначный код из письма. Он действует 15 минут. Бонус по партнёрской ссылке начисляется только после подтверждения email."
    :legacy?"Подтверждение электронной почты пока настраивается. Сейчас регистрация доступна тестировщикам со старым кодом доступа; партнёрский код необязателен."
    :registration&&state.signupMode==="email"
      ?"Мы отправим письмо с кодом подтверждения. Без партнёрской ссылки регистрация тоже доступна."
      :registration?"Открытая регистрация будет доступна после подключения почтовой отправки."
      :"Войдите с той же почтой, которую использовали при регистрации. Пароль можно сохранить в менеджере паролей браузера.";
}
function currentPrice(){
  if(state.mode==="consult"&&state.docIds.size)return Math.max(3,state.docIds.size*3);
  return state.prices[state.mode]||1;
}
function updateModeHint(){
  const cost=currentPrice();
  $("#modeHint").textContent=(MODE_HELP[state.mode]||"")+" · стоимость: "+cost+" AI-токен"+(cost===1?"":cost<5?"а":"ов")+" (внутренние кредиты)";
}
async function offerBrowserPasswordSave(email,password) {
  // Only the browser's password manager may save credentials after explicit opt-in.
  // Never store a password in app cookies, localStorage or our database as plaintext.
  if(!("PasswordCredential" in window)||!navigator.credentials?.store)return;
  try {
    await navigator.credentials.store(new PasswordCredential({
      id:email,password,name:"AI Lawyer Kazakhstan"
    }));
  }catch{
    // The browser may decline, or not implement password credentials; HTML
    // autocomplete remains available in either case.
  }
}
function oauthMessage() {
  const p=new URLSearchParams(location.search);
  const error=p.get("auth_error");
  const notice=p.get("auth_notice");
  if(error==="google_link_required") showError("Почта уже зарегистрирована. Войдите с паролем, затем нажмите «Подключить Google».","#authError");
  else if(error==="google_login_failed")showError("Не удалось войти через Google. Проверьте настройки или попробуйте снова.","#authError");
  else if(notice==="google_linked")showError("Аккаунт Google успешно подключён.","#notice");
  if(error||notice){
    p.delete("auth_error");p.delete("auth_notice");
    const query=p.toString();
    history.replaceState(null,"",location.pathname+(query?"?"+query:""));
  }
}
async function boot() {
  try {
    const s=await request("/session");
    state.signupMode=s.signupMode||"invite";
    state.googleEnabled=!!s.googleEnabled;
    state.prices=s.prices||state.prices;
    state.balance=s.balance??null;
    updateAuthUi();
    if(!s.authenticated) {authView(false);oauthMessage();return;}
    state.user=s.user;state.dailyLimit=s.dailyLimit;
    authView(true);$("#who").textContent=s.user.email;
    $("#googleLink").hidden=!state.googleEnabled||!!s.user.googleLinked;
    oauthMessage();
    if(!s.configured) showError("AI-ключ ещё не подключён. Можно подготовить дела и документы.");
    await loadCases();
  } catch(e){authView(false);showError(e.message,"#authError");}
}
async function loadCases(preferredId) {
  const data=await request("/cases");state.cases=data.cases;
  state.balance=data.balance??null;
  state.prices=data.prices||state.prices;
  $("#daily").textContent="AI-токены сегодня: "+data.usedToday+" / "+state.dailyLimit+
    (state.balance===null?"":" · Баланс: "+state.balance);
  updateModeHint();
  renderCaseList();
  const target=preferredId||state.current?.case.id||data.cases[0]?.id;
  if(target && data.cases.some(c=>c.id===target)) await loadCase(target);
  else resetCase();
}
function renderCaseList() {
  const wrap=$("#caseList");wrap.replaceChildren();
  for(const c of state.cases) {
    const b=document.createElement("button");
    b.className="casebtn"+(state.current?.case.id===c.id?" active":"");
    b.textContent=c.title;b.title=c.objective||c.title;
    b.addEventListener("click",()=>loadCase(c.id).catch(e=>showError(e.message)));
    wrap.append(b);
  }
}
function resetCase() {
  state.current=null;state.docIds.clear();
  updateSelectedCount();
  $("#caseTitle").textContent="Выберите дело";
  $("#messages").replaceChildren();$("#docList").replaceChildren();
  $("#empty").style.display="block";$("#composer").hidden=true;
  $("#docPanel").style.display="none";$("#summaryPanel").style.display="none";
  ["#toggleDocs","#toggleSummary","#deleteCase"].forEach(s=>$(s).disabled=true);
  renderCaseList();
}
async function loadCase(id,{retainSelection=false}={}) {
  const data=await request("/cases/"+id);
  const selected=retainSelection?new Set(state.docIds):new Set();
  const available=new Set(data.documents.map(d=>d.id));
  state.current=data;
  state.docIds=new Set([...selected].filter(docId=>available.has(docId)));
  renderCaseList();
  $("#caseTitle").textContent=data.case.title;
  $("#empty").style.display="none";$("#composer").hidden=false;
  ["#toggleDocs","#toggleSummary","#deleteCase"].forEach(s=>$(s).disabled=false);
  renderMessages();renderDocs();renderSummary();updateSelectedCount();
}
function renderMessages() {
  const wrap=$("#messages");wrap.replaceChildren();
  const all=state.current?.messages||[];
  for(const msg of all) {
    const block=document.createElement("article");block.className="msg "+msg.role;
    const meta=document.createElement("div");meta.className="meta";
    const role=document.createElement("span");role.textContent=msg.role==="user"?"Клиент":"AI Lawyer";
    const stamp=document.createElement("span");stamp.textContent=new Date(msg.createdAt).toLocaleString("ru-RU");
    meta.append(role,stamp);block.append(meta);
    block.append(msg.role==="assistant"?formattedAnswer(msg.text):(()=>{
      const txt=document.createElement("div");txt.textContent=msg.text;return txt;
    })());
    if(msg.sources?.length) {
      const src=document.createElement("div");src.className="sources";
      const title=document.createElement("b");title.textContent="Источники поиска:";src.append(title);
      for(const s of msg.sources) {
        try {const url=new URL(s.url);if(url.protocol!=="https:") continue;
          const a=document.createElement("a");a.href=url.href;a.target="_blank";a.rel="noopener noreferrer";
          a.textContent=s.title||url.hostname;src.append(a);
        } catch {}
      }
      block.append(src);
    }
    if(msg.role==="assistant") {
      const copy=document.createElement("button");copy.className="linkbutton";copy.textContent="Копировать";
      copy.addEventListener("click",()=>navigator.clipboard.writeText(plainLegalText(msg.text)).catch(()=>showError("Копирование недоступно")));
      const save=document.createElement("button");save.className="linkbutton";save.textContent="Сохранить TXT";
      save.addEventListener("click",()=>downloadText(plainLegalText(msg.text),"ai-lawyer-analysis.txt"));
      block.append(copy,save);
      for(const [format,label] of [["docx","Скачать Word"],["pdf","Скачать PDF"]]){
        const b=document.createElement("button");b.className="linkbutton";b.textContent=label;
        b.addEventListener("click",()=>downloadExport(state.current.case.id,msg.id,format,b));
        block.append(b);
      }
    }
    wrap.append(block);
  }
  wrap.scrollTop=wrap.scrollHeight;
}
function downloadText(text,name) {
  const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),250);
}
function renderDocs() {
  const wrap=$("#docList");wrap.replaceChildren();
  for(const d of state.current?.documents||[]) {
    const el=document.createElement("div");el.className="doc";
    const check=document.createElement("input");check.type="checkbox";check.checked=state.docIds.has(d.id);
    check.style.width="auto";
    check.addEventListener("change",()=>{
      if(check.checked && state.docIds.size>=3){check.checked=false;showError("Одновременно можно выбрать до трёх документов");return;}
      check.checked?state.docIds.add(d.id):state.docIds.delete(d.id);
      updateSelectedCount();
    });
    const label=document.createElement("label");label.textContent=d.filename;label.title=d.filename;
    const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.title="Удалить документ";
    remove.addEventListener("click",async()=>{
      if(!confirm("Удалить документ из дела?")) return;
      try {await request("/cases/"+state.current.case.id+"/documents/"+d.id,{method:"DELETE"});
        const id=state.current.case.id;await loadCase(id);$("#docPanel").style.display="block";
      }catch(e){showError(e.message);}
    });
    el.append(check,label,remove);wrap.append(el);
  }
}
function renderSummary() {
  const panel=$("#summaryPanel");
  panel.replaceChildren();
  const summary=state.current?.case.summary||"Память дела ещё не сформирована.";
  const txt=document.createElement("div");txt.textContent=summary;panel.append(txt);
  const refresh=document.createElement("button");refresh.className="secondary";refresh.style.marginTop="10px";
  refresh.textContent="Обновить карточку дела";
  refresh.addEventListener("click",async()=>{
    if(state.busy) return;state.busy=true;refresh.disabled=true;refresh.textContent="Анализ...";
    try{
      const id=state.current.case.id;
      await post("/cases/"+id+"/compact",{});
      await loadCase(id);$("#summaryPanel").style.display="block";await loadCases(id);
    }catch(e){showError(e.message);}finally{state.busy=false;refresh.disabled=false;refresh.textContent="Обновить карточку дела";}
  });
  panel.append(refresh);
}
$("#toggleRegister").addEventListener("click",()=>{
  state.registered=!state.registered;
  state.awaitingCode=false;
  state.legacyInviteVisible=false;
  $("#verifyCode").value="";
  $("#authError").textContent="";
  updateAuthUi();
});
$("#legacyInviteToggle").addEventListener("click",()=>{
  state.legacyInviteVisible=!state.legacyInviteVisible;
  $("#authError").textContent="";
  updateAuthUi();
});
$("#googleLogin").addEventListener("click",()=>{
  if(!state.googleEnabled)return;
  const p=new URLSearchParams({remember:$("#remember").checked?"1":"0"});
  const code=$("#referralCode").value.trim().toUpperCase();
  if(code)p.set("ref",code);
  if(sourceFromLink)p.set("src",sourceFromLink);
  location.assign("/chat/auth/google/start?"+p.toString());
});
$("#googleLink").addEventListener("click",()=>{
  if(!state.googleEnabled)return;
  location.assign("/chat/auth/google/start?link=1");
});
$("#authForm").addEventListener("submit",async ev=>{
  ev.preventDefault();$("#authError").textContent="";
  const submit=$("#authSubmit");submit.disabled=true;
  try {
    const email=$("#email").value.trim(), remember=$("#remember").checked;
    if(state.awaitingCode) {
      await post("/auth/email-verify",{email,code:$("#verifyCode").value.trim()});
      state.awaitingCode=false;
    } else if(state.registered&&state.signupMode==="email") {
      await post("/auth/email-start",{
        email,password:$("#password").value,remember,
        referralCode:$("#referralCode").value.trim().toUpperCase(),
        referralSource:sourceFromLink
      });
      state.awaitingCode=true;updateAuthUi();
      $("#verifyCode").focus();
      return;
    } else {
      const body={email,password:$("#password").value,remember};
      if(state.registered){
        if(!state.legacyInviteVisible)throw Error("Почтовое подтверждение пока настраивается. Для тестового доступа укажите существующий код приглашения.");
        body.invite=$("#invite").value;
      }
      await post("/auth/"+(state.registered?"register":"login"),body);
    }
    const enteredPassword=$("#password").value;
    if(remember&&enteredPassword)void offerBrowserPasswordSave(email,enteredPassword);
    $("#password").value="";$("#invite").value="";$("#verifyCode").value="";
    await boot();
  } catch(e) {showError(e.message,"#authError");}
  finally {submit.disabled=false;}
});
$("#logout").addEventListener("click",async()=>{
  try{await post("/auth/logout",{});state.user=null;state.current=null;authView(false);}
  catch(e){showError(e.message);}
});
$("#createCase").addEventListener("click",async()=>{
  const title=prompt("Название дела:");
  if(!title?.trim()) return;
  const objective=prompt("Цель дела (можно оставить пустой):")||"";
  try{const d=await post("/cases",{title,objective});await loadCases(d.case.id);}
  catch(e){showError(e.message);}
});
$("#deleteCase").addEventListener("click",async()=>{
  if(!state.current) return;
  const phrase=prompt("Для удаления дела, переписки и файлов напишите УДАЛИТЬ:");
  if(phrase!=="УДАЛИТЬ") return;
  try{await request("/cases/"+state.current.case.id,{method:"DELETE",body:JSON.stringify({confirm:phrase}),headers:{"content-type":"application/json"}});state.current=null;await loadCases();}
  catch(e){showError(e.message);}
});
$("#toggleDocs").addEventListener("click",()=>{
  const p=$("#docPanel");p.style.display=p.style.display==="block"?"none":"block";
});
$("#toggleSummary").addEventListener("click",()=>{
  const p=$("#summaryPanel");p.style.display=p.style.display==="block"?"none":"block";
});
$("#modes").addEventListener("click",ev=>{
  const b=ev.target.closest("button[data-mode]");if(!b) return;
  state.mode=b.dataset.mode;
  updateModeHint();
  for(const e of $("#modes").querySelectorAll("button"))e.classList.toggle("selected",e===b);
});
$("#attachShortcut").addEventListener("click",()=>{
  if(!state.current || state.busy) return;
  $("#docPanel").style.display="block";
  $("#uploadInput").click();
});
$("#uploadInput").addEventListener("change",async ev=>{
  if(!state.current || state.busy) return;
  const id=state.current.case.id;
  const selected=new Set(state.docIds);
  let uploaded=0;
  for(const file of [...ev.target.files]) {
    if(file.size>7*1024*1024){showError("Превышен лимит 7 МБ: "+file.name);continue;}
    try{
      const data=await request("/cases/"+id+"/documents",{
        method:"POST",body:file,headers:{"x-filename":encodeURIComponent(file.name)}
      });
      uploaded++;
      if(selected.size<3) selected.add(data.document.id);
    } catch(e){showError(file.name+": "+e.message);}
  }
  state.docIds=selected;
  ev.target.value="";
  await loadCase(id,{retainSelection:true});
  $("#docPanel").style.display="block";
  if(uploaded>3 && state.docIds.size===3)
    showError("Загружено файлов: "+uploaded+". В запрос выбрано максимум 3; остальные сохранены в деле.");
});
$("#messageForm").addEventListener("submit",async ev=>{
  ev.preventDefault();if(state.busy||!state.current) return;
  const message=$("#messageInput").value.trim();if(!message) return;
  const id=state.current.case.id, mode=state.mode, docIds=[...state.docIds];
  state.busy=true;$("#send").disabled=true;$("#send").textContent="Анализ...";
  clearError();
  try{
    await post("/cases/"+id+"/chat",{message,mode,docIds});
    $("#messageInput").value="";await loadCases(id);
  }catch(e){showError(e.message);}
  finally{state.busy=false;$("#send").disabled=false;$("#send").textContent="Отправить";}
});
$("#messageInput").addEventListener("keydown",ev=>{
  if(ev.key==="Enter"&&(ev.ctrlKey||ev.metaKey)){ev.preventDefault();$("#messageForm").requestSubmit();}
});
if(referralFromLink)$("#referralCode").value=referralFromLink;
boot();
