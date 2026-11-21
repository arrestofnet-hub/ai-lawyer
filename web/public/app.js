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
    const endpoint=caseId
      ? API+"/cases/"+encodeURIComponent(caseId)+"/export/"+encodeURIComponent(messageId)
      : API+"/guest/export/"+encodeURIComponent(messageId);
    const response=await fetch(endpoint+"?format="+encodeURIComponent(format),{
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
const state = { user:null, guest:null, cases:[], current:null, mode:"consult", docIds:new Set(), guestDocIds:new Set(),guestUploadBusy:false,
  busy:false, registered:false, awaitingCode:false, signupMode:"invite",
  legacyInviteVisible:false, googleEnabled:false, googleSignupEnabled:false, dailyLimit:0,balance:null,
  pendingRequest:null,packages:[],
  prices:{consult:1500,audit:8000,strategy:12000,draft:5000,review:12000,compact:3000}
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
  if(!res.ok) throw Object.assign(new Error(data.error||"Ошибка сервера"),{guest:data.guest,status:res.status});
  return data;
}
const post=(route,body)=>request(route,{method:"POST",body:JSON.stringify(body)});
const formatCount=value=>Number(value).toLocaleString("ru-RU");
function renderPackages() {
  const root=$("#packageOffers");
  root.replaceChildren();
  for(const [i,pkg] of state.packages.entries()){
    const article=document.createElement("article");
    article.className="plan-card";
    const heading=document.createElement("h3");heading.textContent=pkg.name||["Пробный","Старт","Плюс","Практика","Профессиональный"][i]||"Пакет";
    const price=document.createElement("strong");price.textContent=formatCount(pkg.priceKzt)+" ₸";
    const details=document.createElement("p");details.textContent=formatCount(pkg.tokens)+" токенов AI Lawyer";
    const buy=document.createElement("button");buy.type="button";buy.disabled=true;
    buy.className="secondary";buy.textContent="Оплата подключается";
    article.append(heading,price,details,buy);root.append(article);
  }
  const compact=$("#guestPricePreview .compact-packages");
  compact.replaceChildren();
  for(const pkg of state.packages){
    const span=document.createElement("span");
    span.textContent=formatCount(pkg.tokens)+" — "+formatCount(pkg.priceKzt)+" ₸";
    compact.append(span);
  }
}
function showPlans() { if(!$("#plans").open)$("#plans").showModal(); }
function setAppVisible(visible) {
  $("#app").style.display=visible?"grid":"none";
}
function guestCanSend(guest,mode=state.mode) {
  return !!guest && (mode==="draft" ? guest.documentRemaining>0 : guest.remaining>0);
}
function guestHasAccess(guest) {
  return guestCanSend(guest,"consult") || guestCanSend(guest,"draft");
}
function syncGuestModeButtons(guest) {
  for(const button of $("#guestModes").querySelectorAll("button[data-mode]")){
    button.classList.toggle("selected",button.dataset.mode===state.mode);
    button.disabled=!guestCanSend(guest,button.dataset.mode);
  }
}
function openAuth(register,{reminder=false}={}) {
  const dialog=$("#authScreen");
  if(state.guest&&state.busy&&!reminder)return;
  if(!dialog.open){
    state.registered=register;
    state.awaitingCode=false;
    state.legacyInviteVisible=false;
    $("#verifyCode").value="";
    $("#confirmPassword").value="";
    $("#authError").textContent="";
    showPasswordRecovery(false);
    updateAuthUi();
  }
  const guest=state.guest;
  $("#guestAuthNote").hidden=!guest;
  $("#guestAuthNote").textContent=guest?.restriction
    || (guestHasAccess(guest)
      ? "Остаток: "+formatCount(guest.tokenBalance)+" из 20 000 гостевых токенов. После регистрации получите ещё 20 000, сохранив остаток."
      : "Гостевой доступ завершён. Зарегистрируйтесь, чтобы получить ещё 20 000 токенов и сохранить неиспользованный остаток.");
  $("#guestPricePreview").hidden=!guest||guestHasAccess(guest);
  // Even when credits are exhausted, a guest must be able to close the
  // upsell and download a document already generated in the conversation.
  $("#closeAuth").hidden=!guest||(!guestHasAccess(guest)&&!guest.messages?.length);
  if(!dialog.open)dialog.showModal();
}
function renderGuestDocuments(){
  const list=$("#guestUploadedList");
  list.replaceChildren();
  const docs=state.guest?.documents||[];
  const selected=state.guestDocIds;
  const total=docs.reduce((sum,d)=>sum+d.size,0);
  $("#guestAttachmentHint").textContent=
    "PDF, Word, фото или текст · "+docs.length+" из 3 файлов · "+
    (total/1024/1024).toFixed(2)+" / 1,43 МБ";
  $("#guestAttachShortcut").disabled=state.busy||state.guestUploadBusy||docs.length>=3;
  for(const d of docs){
    const chip=document.createElement("div");chip.className="guest-file";
    const label=document.createElement("label");label.title=d.filename;
    const check=document.createElement("input");check.type="checkbox";check.checked=selected.has(d.id);
    check.disabled=state.busy||state.guestUploadBusy;
    check.addEventListener("change",()=>{
      if(check.checked)state.guestDocIds.add(d.id);
      else state.guestDocIds.delete(d.id);
      state.pendingRequest=null;
    });
    const name=document.createElement("span");name.className="file-name";name.textContent=d.filename;
    label.append(check,name);
    const remove=document.createElement("button");remove.type="button";remove.textContent="×";
    remove.title="Удалить гостевой файл";remove.setAttribute("aria-label","Удалить "+d.filename);
    remove.disabled=state.busy||state.guestUploadBusy;
    remove.addEventListener("click",async()=>{
      if(state.busy||state.guestUploadBusy)return;
      state.guestUploadBusy=true;renderGuestDocuments();
      try{
        const updated=await request("/guest/documents/"+encodeURIComponent(d.id),{method:"DELETE"});
        state.guestDocIds.delete(d.id);state.pendingRequest=null;
        updateGuest(updated);
      }catch(e){showError(e.message);}
      finally{state.guestUploadBusy=false;renderGuestDocuments();}
    });
    chip.append(label,remove);list.append(chip);
  }
}

function updateGuest(guest) {
  state.guest=guest;
  const availableIds=new Set((guest.documents||[]).map(d=>d.id));
  state.guestDocIds=new Set([...state.guestDocIds].filter(id=>availableIds.has(id)));
  // An unused document bonus remains available after the last consultation.
  if(!guestCanSend(guest,state.mode)) {
    if(guest.remaining>0)state.mode="consult";
    else if(guest.documentRemaining>0)state.mode="draft";
  }
  $("#daily").textContent="Бесплатные токены: "+formatCount(guest.tokenBalance)+" / "+formatCount(guest.tokenLimit)+
    " · до 10 консультаций и 1 документа"+(guest.restriction?" · "+guest.restriction:"");
  $("#guestWelcome").hidden=guest.messages.length>0;
  $("#messages").hidden=!guest.messages.length;
  $("#send").disabled=state.busy||state.guestUploadBusy||!guestCanSend(guest);
  $("#messageInput").disabled=!guestCanSend(guest);
  $("#modeHint").textContent=state.mode==="draft"
    ? "Документ · "+formatCount(guest.documentTokenCost)+" токенов. После ответа доступны Word и PDF."
    : "Консультация · "+formatCount(guest.tokenCost)+" токенов. Один документ стоит "+formatCount(guest.documentTokenCost)+".";
  syncGuestModeButtons(guest);
  renderGuestDocuments();
  renderMessages();
}
function guestView(guest) {
  state.user=null;
  state.current=null;
  state.docIds.clear();
  state.guestDocIds=new Set((guest.documents||[]).map(d=>d.id));
  state.mode=guest.remaining>0 ? "consult" : guest.documentRemaining>0 ? "draft" : "consult";
  $("#guestModes").hidden=false;
  document.body.classList.add("guest-mode");
  $("#app").hidden=false;
  setAppVisible(true);
  $("#guestLogin").hidden=false;
  $("#guestRegister").hidden=false;
  $("#who").textContent="";
  $("#caseTitle").textContent="Гостевой чат";
  $("#messageInput").placeholder="Задайте юридический вопрос";
  $("#docPanel").style.display="none";
  $("#guestUploadPanel").hidden=false;
  $("#summaryPanel").style.display="none";
  $("#empty").style.display="none";
  $("#composer").hidden=false;
  updateGuest(guest);
}
function updateAuthUi() {
  const registration=state.registered;
  const requiresCode=state.awaitingCode;
  const legacy=registration&&state.signupMode==="invite"&&!requiresCode;
  $("#referralWrap").hidden=!registration||requiresCode;
  $("#referralHelp").textContent=legacy
    ?"Партнёрский код необязателен. После подключения подтверждения email по действующей ссылке будет доступно 5 000 бонусных токенов."
    :"Нет партнёрской ссылки? Оставьте поле пустым. Действующий код даёт 5 000 бонусных токенов после подтверждения почты (50 обычных консультаций).";
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
  const confirmNeeded=registration&&!requiresCode;
  $("#confirmPasswordWrap").hidden=!confirmNeeded;
  $("#confirmPassword").required=confirmNeeded;
  $("#confirmPassword").disabled=!confirmNeeded;
  $("#confirmPassword").autocomplete="new-password";
  $("#showPasswordWrap").hidden=requiresCode;
  validatePasswordMatch(false);
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
function validatePasswordMatch(showErrors=true){
  const confirm=$("#confirmPassword");
  const help=$("#confirmPasswordHelp");
  const first=$("#password").value;
  const repeated=confirm.value;
  const relevant=state.registered&&!state.awaitingCode;
  const mismatch=relevant&&repeated.length>0&&first!==repeated;
  confirm.setCustomValidity(mismatch?"Пароли не совпадают":"");
  help.classList.toggle("invalid",mismatch);
  help.textContent=mismatch?"Пароли не совпадают":relevant&&repeated.length>0?"Пароли совпадают":"Повторите пароль для проверки";
  if(showErrors&&mismatch)confirm.reportValidity();
  return !mismatch&&(!relevant||first===repeated);
}
function currentPrice(){
  if(state.mode==="consult"&&state.docIds.size)return 4500+Math.max(0,state.docIds.size-1)*1500;
  return state.prices[state.mode]||1500;
}
function updateModeHint(){
  const cost=currentPrice();
  $("#modeHint").textContent=(MODE_HELP[state.mode]||"")+" · стоимость: "+cost+" внутренних токенов. При ошибке токены не списываются.";
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
  else if(error==="google_network_failed")
    showError("Сервер не смог связаться с Google. Пожалуйста, повторите попытку позже.","#authError");
  else if(error==="google_token_rejected")
    showError("Google отклонил авторизацию. Повторите вход; если ошибка сохраняется, обратитесь в поддержку.","#authError");
  else if(error==="google_signup_disabled")
    showError("Вход Google настроен, но создание новых аккаунтов через Google пока выключено. Зарегистрируйтесь по email.","#authError");
  else if(error==="google_signup_limited")
    showError("Лимит новых Google-регистраций временно исчерпан. Попробуйте позже или используйте email.","#authError");
  else if(error==="google_identity_failed")
    showError("Не удалось проверить данные Google. Попробуйте войти повторно.","#authError");
  else if(error==="google_state_invalid")
    showError("Сеанс входа Google истёк или был открыт в другой вкладке. Начните вход снова.","#authError");
  else if(error==="google_cancelled")
    showError("Вход через Google был отменён.","#authError");
  else if(error==="google_link_mismatch")
    showError("Для привязки выберите Google-аккаунт с тем же email, что у вашего кабинета.","#authError");
  else if(error==="google_login_failed")
    showError("Не удалось войти через Google. Попробуйте позже либо используйте email.","#authError");
  else if(notice==="google_linked")showError("Аккаунт Google успешно подключён.","#notice");
  else if(notice==="google_registered"&&state.user)$("#plans").showModal();
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
    state.googleSignupEnabled=!!s.googleSignupEnabled;
    $("#googleAuthHelp").textContent=!state.googleEnabled
      ? "Вход через Google сейчас недоступен."
      : state.googleSignupEnabled
        ? "Через Google можно войти или создать новый аккаунт."
        : "Вход Google доступен для привязанных аккаунтов. Новые аккаунты пока создаются через email.";
    state.prices=s.prices||state.prices;
    state.packages=Array.isArray(s.packages)?s.packages:[];
    renderPackages();
    state.balance=s.balance??null;
    $("#freePlanDetails").textContent="20 000 гостевых токенов + "+formatCount(s.trialCredits||20000)+
      " после подтверждённой регистрации. Неиспользованный гостевой остаток сохраняется.";
    updateAuthUi();
    if(!s.authenticated) {
      const oauthError=new URLSearchParams(location.search).has("auth_error");
      if(s.guestEnabled){
        const guest=await request("/guest");
        guestView(guest);
        if(!guestHasAccess(guest)||oauthError)openAuth(!guestHasAccess(guest));
      }else{
        state.guest=null;
        document.body.classList.remove("guest-mode");
        setAppVisible(false);
        openAuth(false);
      }
      oauthMessage();
      return;
    }
    state.guest=null;
    state.guestDocIds.clear();
    $("#guestUploadPanel").hidden=true;
    $("#guestModes").hidden=true;
    document.body.classList.remove("guest-mode");
    $("#guestWelcome").hidden=true;
    $("#messages").hidden=false;
    $("#guestLogin").hidden=true;
    $("#guestRegister").hidden=true;
    $("#messageInput").disabled=false;
    $("#messageInput").placeholder="Опишите задачу по делу";
    $("#authScreen").close();
    state.user=s.user;state.dailyLimit=s.dailyLimit;
    setAppVisible(true);$("#who").textContent=s.user.email;
    $("#googleLink").hidden=!state.googleEnabled||!!s.user.googleLinked;
    oauthMessage();
    if(!s.configured) showError("AI-ключ ещё не подключён. Можно подготовить дела и документы.");
    await loadCases();
  } catch(e){openAuth(false);showError(e.message,"#authError");}
}
async function loadCases(preferredId) {
  const data=await request("/cases");state.cases=data.cases;
  state.balance=data.balance??null;
  state.prices=data.prices||state.prices;
  $("#daily").textContent="Токены сегодня: "+formatCount(data.usedToday)+" / "+formatCount(state.dailyLimit)+
    (state.balance===null?"":" · Баланс: "+formatCount(state.balance));
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
  const all=state.guest?.messages||state.current?.messages||[];
  for(const msg of all) {
    const block=document.createElement("article");block.className="msg "+msg.role;
    const meta=document.createElement("div");meta.className="meta";
    const role=document.createElement("span");role.textContent=msg.role==="user"?"Клиент":"AI Lawyer";
    const stamp=document.createElement("span");stamp.textContent=new Date(msg.createdAt).toLocaleString("ru-RU");
    meta.append(role,stamp);block.append(meta);
    block.append(msg.role==="assistant"?formattedAnswer(msg.text):(()=>{
      const txt=document.createElement("div");txt.textContent=msg.text;return txt;
    })());
    if(msg.role==="user"&&Array.isArray(msg.attachments)&&msg.attachments.length){
      const names=document.createElement("div");names.className="meta";
      names.textContent="📎 "+msg.attachments.join(", ");
      block.append(names);
    }
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
        b.addEventListener("click",()=>downloadExport(state.guest?null:state.current.case.id,msg.id,format,b));
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
  const area=document.createElement("section");
  area.className="dossier-section";
  panel.append(area);
  const caseId=state.current?.case.id;
  if(caseId)renderDossierArea(caseId,area).catch(e=>showError(e.message));
}
async function renderDossierArea(caseId,area){
  const info=await request("/cases/"+caseId+"/dossier");
  if(state.current?.case.id!==caseId||!area.isConnected)return;
  area.replaceChildren();
  const d=info.dossier;
  const heading=document.createElement("h3");
  heading.textContent="Факты, доказательства и контроль сроков";area.append(heading);
  function line(text,cls=""){
    const p=document.createElement("p");p.textContent=text;p.className=cls;area.append(p);return p;
  }
  line("Сохраняется отдельно по этому делу. Даты и суммы ниже получены из слов клиента, а не признаны установленными фактами.","muted");
  line("Редакция карточки: "+d.revision+(d.updatedAt?" · "+new Date(d.updatedAt).toLocaleString("ru-RU"):""),"muted");
  const sourceById=new Map(info.sources.map(x=>[x.id,x]));
  if(d.facts.length){
    const h=document.createElement("h4");h.textContent="Реестр обстоятельств";area.append(h);
    for(const fact of d.facts){
      const block=document.createElement("div");block.className="dossier-record";
      const label=document.createElement("b");
      const labels={claimed:"Заявлено",supported:"Есть указанный источник (не проверен)",disputed:"Оспаривается",unknown:"Не установлено"};
      label.textContent=(labels[fact.status]||fact.status)+": "+fact.statement;
      block.append(label);
      if(fact.eventDate){const t=document.createElement("div");t.textContent="Дата: "+fact.eventDate;block.append(t);}
      if(fact.sourceIds.length){
        const t=document.createElement("div");t.textContent="Источник: "+fact.sourceIds.map(id=>sourceById.get(id)?.title||id).join("; ");
        block.append(t);
      }
      if(fact.note){const t=document.createElement("div");t.textContent=fact.note;block.append(t);}
      const remove=document.createElement("button");remove.type="button";remove.className="linkbutton";remove.textContent="Исключить из реестра";
      remove.addEventListener("click",async()=>{
        if(!confirm("Исключить обстоятельство из текущей карточки? Предыдущая версия сохранится."))return;
        try{
          remove.disabled=true;
          await request("/cases/"+caseId+"/dossier",{method:"PATCH",
            body:JSON.stringify({...d,facts:d.facts.filter(x=>x.id!==fact.id)})});
          if(state.current?.case.id===caseId)renderSummary();
        }catch(e){showError(e.message);remove.disabled=false;}
      });
      block.append(remove);area.append(block);
    }
  }
  const dateEntries=info.chronology.slice(0,8);
  if(dateEntries.length){
    const h=document.createElement("h4");h.textContent="Даты, обнаруженные в сообщениях";area.append(h);
    for(const x of dateEntries)line(x.date+" — "+x.quote,"dossier-excerpt");
  }
  const amountEntries=info.amounts.slice(0,8);
  if(amountEntries.length){
    const h=document.createElement("h4");h.textContent="Упомянутые суммы (не сверены)";area.append(h);
    for(const x of amountEntries)line(x.amount+" — "+x.quote,"dossier-excerpt");
  }
  const add=document.createElement("button");add.type="button";add.className="secondary";
  add.textContent="+ Записать обстоятельство";area.append(add);
  const form=document.createElement("form");form.className="dossier-edit";form.hidden=true;
  const statement=document.createElement("textarea");statement.placeholder="Факт или позиция стороны";statement.maxLength=1500;statement.required=true;statement.rows=2;
  const category=document.createElement("select");
  for(const [v,t] of [["fact","Обстоятельство"],["contract","Договор"],["payment","Платёж"],["notice","Уведомление"],["procedure","Процессуальное действие"],["deadline","Срок"],["other","Другое"]]){
    const o=document.createElement("option");o.value=v;o.textContent=t;category.append(o);
  }
  const status=document.createElement("select");
  for(const [v,t] of [["claimed","Заявлено"],["supported","Есть источник (нужна проверка)"],["disputed","Оспаривается"],["unknown","Не установлено"]]){
    const o=document.createElement("option");o.value=v;o.textContent=t;status.append(o);
  }
  const source=document.createElement("select");
  const none=document.createElement("option");none.value="";none.textContent="Источник не указан";source.append(none);
  for(const x of info.sources){
    const o=document.createElement("option");o.value=x.id;o.textContent=x.title.slice(0,90);source.append(o);
  }
  const date=document.createElement("input");date.type="date";date.title="Дата события (необязательно)";
  const note=document.createElement("input");note.placeholder="Проверка, пункт документа, замечание";note.maxLength=800;
  const save=document.createElement("button");save.className="secondary";save.type="submit";save.textContent="Сохранить факт";
  form.append(statement,category,status,source,date,note,save);area.append(form);
  add.addEventListener("click",()=>{form.hidden=!form.hidden;if(!form.hidden)statement.focus();});
  form.addEventListener("submit",async ev=>{
    ev.preventDefault();
    save.disabled=true;
    try{
      if(status.value==="supported"&&!source.value)throw Error("Для подтверждения укажите источник из дела");
      const fact={statement:statement.value,category:category.value,status:status.value,
        sourceIds:source.value?[source.value]:[],eventDate:date.value||null,note:note.value};
      await request("/cases/"+caseId+"/dossier",{method:"PATCH",
        body:JSON.stringify({...d,facts:[...d.facts,fact]})});
      if(state.current?.case.id===caseId)renderSummary();
    }catch(e){showError(e.message);save.disabled=false;}
  });
  const h=document.createElement("h4");h.textContent="Действия и контроль дат";area.append(h);
  for(const task of d.tasks){
    const b=document.createElement("div");b.className="dossier-record";
    const label=document.createElement("span");label.textContent=(task.state==="done"?"Выполнено: ":"В работе: ")+task.title+
      (task.dueDate?" · "+task.dueDate:"");b.append(label);
    if(task.state!=="done"){
      const done=document.createElement("button");done.className="linkbutton";done.textContent="Отметить выполненным";
      done.addEventListener("click",async()=>{
        try{
          done.disabled=true;
          await request("/cases/"+caseId+"/dossier",{method:"PATCH",
            body:JSON.stringify({...d,tasks:d.tasks.map(t=>t.id===task.id?{...t,state:"done"}:t)})});
          if(state.current?.case.id===caseId)renderSummary();
        }catch(e){showError(e.message);done.disabled=false;}
      });b.append(done);
    }
    area.append(b);
  }
  const taskForm=document.createElement("form");taskForm.className="dossier-edit";
  const title=document.createElement("input");title.placeholder="Следующее действие (кому и что направить)";title.maxLength=320;title.required=true;
  const due=document.createElement("input");due.type="date";due.title="Контрольная дата, если известна";
  const taskSave=document.createElement("button");taskSave.className="secondary";taskSave.textContent="Добавить действие";taskSave.type="submit";
  taskForm.append(title,due,taskSave);area.append(taskForm);
  taskForm.addEventListener("submit",async ev=>{
    ev.preventDefault();taskSave.disabled=true;
    try{
      await request("/cases/"+caseId+"/dossier",{method:"PATCH",
        body:JSON.stringify({...d,tasks:[...d.tasks,
          {title:title.value,state:"open",dueDate:due.value||null,note:""}]})});
      if(state.current?.case.id===caseId)renderSummary();
    }catch(e){showError(e.message);taskSave.disabled=false;}
  });
  line("Контрольная дата — рабочая пометка. Процессуальный срок по закону нужно проверить отдельно.","muted");
}
let resetStep="request";
function showPasswordRecovery(show){
  $("#loginOptions").hidden=show;
  $("#resetPanel").hidden=!show;
  if(show){
    resetStep="request";
    $("#resetEmail").value=$("#email").value.trim();
    $("#resetEmail").readOnly=false;
    $("#resetCodeWrap").hidden=true;
    $("#resetCode").required=false;
    $("#resetPassword").required=false;
    $("#resetConfirm").required=false;
    $("#resetCode").value="";
    $("#resetPassword").value="";
    $("#resetConfirm").value="";
    $("#resetNotice").textContent="";
    $("#resetError").textContent="";
    $("#resetSubmit").textContent="Получить код";
    $("#resetEmail").focus();
  }else{
    $("#resetCode").value="";
    $("#resetPassword").value="";
    $("#resetConfirm").value="";
    $("#resetShowPassword").checked=false;
    $("#resetPassword").type="password";
    $("#resetConfirm").type="password";
  }
}
$("#closeAuth").addEventListener("click",()=>$("#authScreen").close());
$("#authScreen").addEventListener("cancel",ev=>{
  if(state.guest&&!guestHasAccess(state.guest)&&!state.guest.messages?.length)ev.preventDefault();
});
$("#guestLogin").addEventListener("click",()=>openAuth(false));
$("#guestRegister").addEventListener("click",()=>openAuth(true));
async function renderLawSources(query=""){
  const [data,health,articles]=await Promise.all([
    request("/legal/sources"+(query?"?q="+encodeURIComponent(query):"")),
    request("/legal/status"),
    query?request("/legal/articles?q="+encodeURIComponent(query)):
      Promise.resolve({articles:[],count:0})
  ]);
  const root=$("#lawSourcesList");root.replaceChildren();
  $("#lawSourcesStatus").textContent=data.count+
    " актов в подборке · "+(health.snapshotArticles||0)+
    " снимков статей из официальных текстов · проверенных редакций: "+data.verifiedArticles;
  if(query&&articles.articles.length){
    const heading=document.createElement("h3");heading.textContent=
      "Фрагменты статей (дата действия НЕ подтверждена)";
    root.append(heading);
    const note=document.createElement("p");note.className="warning";
    note.textContent="Это тексты, выгруженные из «Әділет». Перед применением к делу проверьте действовавшую редакцию, дату введения и поправки.";
    root.append(note);
    for(const piece of articles.articles){
      const block=document.createElement("article");block.className="law-row";
      const title=document.createElement("strong");title.textContent=piece.article;
      const detail=document.createElement("p");detail.textContent=
        "Акт "+piece.actId+" · снимок "+piece.capturedOn+
        " · юридическая дата действия не проверена";
      const excerpt=document.createElement("p");excerpt.textContent=piece.excerpt;
      const link=document.createElement("a");link.href=piece.sourceUrl;
      link.textContent="Открыть статью в официальном акте";link.rel="noopener noreferrer";
      link.target="_blank";
      block.append(title,detail,excerpt,link);root.append(block);
    }
  }
  for(const source of data.sources){
    const card=document.createElement("article");card.className="law-row";
    const name=document.createElement("strong");name.textContent=source.title;card.append(name);
    const note=document.createElement("p");note.textContent="Ссылки ведут на официальный источник. Тексты статей и применимость редакции не подтверждены этим каталогом.";card.append(note);
    for(const [label,url] of [["Текст акта",source.officialUrl],["История редакций",source.historyUrl]]){
      try{
        const valid=new URL(url);
        if(valid.protocol!=="https:"||valid.hostname!=="adilet.zan.kz")continue;
        const link=document.createElement("a");link.href=valid.href;link.target="_blank";
        link.rel="noopener noreferrer";link.textContent=label;card.append(link);
      }catch{}
    }
    if(source.transition){
      const transition=document.createElement("p");transition.textContent=source.transition;
      transition.style.color="#8d4d16";card.append(transition);
    }
    root.append(card);
  }
}
$("#openLaws").addEventListener("click",()=>{
  if(!$("#lawSources").open)$("#lawSources").showModal();
  renderLawSources().catch(e=>$("#lawSourcesStatus").textContent=e.message);
});
$("#closeLaws").addEventListener("click",()=>$("#lawSources").close());
$("#lawSearchForm").addEventListener("submit",ev=>{
  ev.preventDefault();
  renderLawSources($("#lawSearchQuery").value.trim()).catch(e=>
    $("#lawSourcesStatus").textContent=e.message);
});
$("#openPlans").addEventListener("click",showPlans);
$("#closePlans").addEventListener("click",()=>$("#plans").close());
$("#continueFree").addEventListener("click",()=>$("#plans").close());
$("#forgotPassword").addEventListener("click",()=>showPasswordRecovery(true));
$("#backToLogin").addEventListener("click",()=>showPasswordRecovery(false));
$("#resetShowPassword").addEventListener("change",ev=>{
  const type=ev.target.checked?"text":"password";
  $("#resetPassword").type=type;
  $("#resetConfirm").type=type;
});
$("#resetForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  const button=$("#resetSubmit");
  button.disabled=true;
  $("#resetError").textContent="";
  try{
    const email=$("#resetEmail").value.trim();
    if(resetStep==="request"){
      const result=await post("/auth/password-reset-start",{email});
      resetStep="complete";
      $("#resetEmail").readOnly=true;
      $("#resetCodeWrap").hidden=false;
      $("#resetCode").required=true;
      $("#resetPassword").required=true;
      $("#resetConfirm").required=true;
      $("#resetSubmit").textContent="Изменить пароль";
      $("#resetNotice").textContent=result.message+" Код действует 15 минут. Если письмо не пришло, проверьте адрес.";
      $("#resetCode").focus();
    } else {
      const password=$("#resetPassword").value;
      if(password!==$("#resetConfirm").value)
        throw Error("Новые пароли не совпадают");
      const result=await post("/auth/password-reset-complete",{
        email,code:$("#resetCode").value.trim(),password
      });
      showPasswordRecovery(false);
      $("#email").value=email;
      $("#password").value="";
      $("#authError").style.color="#276444";
      $("#authError").textContent=result.message;
    }
  }catch(e){showError(e.message,"#resetError");}
  finally{button.disabled=false;}
});
$("#showPassword").addEventListener("change",ev=>{
  const type=ev.target.checked?"text":"password";
  $("#password").type=type;
  $("#confirmPassword").type=type;
});
$("#password").addEventListener("input",()=>validatePasswordMatch(false));
$("#confirmPassword").addEventListener("input",()=>validatePasswordMatch(false));
$("#toggleRegister").addEventListener("click",()=>{
  state.registered=!state.registered;
  state.awaitingCode=false;
  state.legacyInviteVisible=false;
  $("#verifyCode").value="";
  $("#confirmPassword").value="";
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
    let authResult=null;
    const email=$("#email").value.trim(), remember=$("#remember").checked;
    if(state.registered&&!state.awaitingCode&&!validatePasswordMatch(true)){
      showError("Проверьте повтор пароля: оба значения должны совпадать.","#authError");
      return;
    }
    if(state.awaitingCode) {
      authResult=await post("/auth/email-verify",{email,code:$("#verifyCode").value.trim()});
      state.awaitingCode=false;
    } else if(state.registered&&state.signupMode==="email") {
      await post("/auth/email-start",{
        email,password:$("#password").value,remember,
        referralCode:$("#referralCode").value.trim().toUpperCase(),
        referralSource:sourceFromLink
      });
      state.awaitingCode=true;
      $("#confirmPassword").value="";
      $("#showPassword").checked=false;
      $("#password").type="password";
      $("#confirmPassword").type="password";
      updateAuthUi();
      $("#verifyCode").focus();
      return;
    } else {
      const body={email,password:$("#password").value,remember};
      if(state.registered){
        if(!state.legacyInviteVisible)throw Error("Почтовое подтверждение пока настраивается. Для тестового доступа укажите существующий код приглашения.");
        body.invite=$("#invite").value;
      }
      authResult=await post("/auth/"+(state.registered?"register":"login"),body);
    }
    const completedRegistration=state.registered;
    const enteredPassword=$("#password").value;
    if(remember&&enteredPassword)void offerBrowserPasswordSave(email,enteredPassword);
    $("#password").value="";$("#confirmPassword").value="";
    $("#showPassword").checked=false;$("#password").type="password";$("#confirmPassword").type="password";
    $("#invite").value="";$("#verifyCode").value="";
    await boot();
    const transferred=!!authResult?.guestCaseId;
    $("#guestHistorySaved").hidden=!transferred;
    if(transferred&&state.user){
      await loadCases(authResult.guestCaseId);
      const notice=$("#notice");
      notice.textContent="Гостевая переписка сохранена в вашем личном деле.";
      notice.style.color="#16683e";
    }
    if(completedRegistration&&state.user)showPlans();
  } catch(e) {showError(e.message,"#authError");}
  finally {submit.disabled=false;}
});
$("#logout").addEventListener("click",async()=>{
  try{await post("/auth/logout",{});state.user=null;state.current=null;state.registered=false;await boot();}
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
$("#guestModes").addEventListener("click",ev=>{
  const button=ev.target.closest("button[data-mode]");
  if(!button || button.disabled || state.busy || !state.guest)return;
  state.mode=button.dataset.mode;
  updateGuest(state.guest);
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
  ev.preventDefault();if(state.busy||(!state.guest&&!state.current)) return;
  const message=$("#messageInput").value.trim();if(!message) return;
  const guest=state.guest;
  if(guest&&!guestCanSend(guest)){openAuth(true);return;}
  const id=state.current?.case.id, mode=state.mode, docIds=[...state.docIds];
  // Reuse the same ID for a retry of the same prompt, so a late server
  // response cannot charge twice if the browser connection timed out.
  const key=JSON.stringify({id:id||null,message,mode,docIds:guest?[]:docIds});
  if(!state.pendingRequest || state.pendingRequest.key!==key){
    state.pendingRequest={key,id:crypto.randomUUID(),caseId:id||null};
  }
  const requestId=state.pendingRequest.id;
  state.busy=true;$("#send").disabled=true;$("#send").textContent="Анализ...";
  clearError();
  const started=Date.now();
  const progress=setInterval(()=>{
    if(!state.busy)return;
    const seconds=Math.floor((Date.now()-started)/1000);
    $("#send").textContent="Анализ... "+seconds+" с";
    if(seconds===20)$("#notice").textContent="Запрос ещё выполняется. Подробный ответ может занять до двух минут.";
  },1000);
  try{
    if(guest){
      const next=await post("/guest/chat",{message,mode,requestId});
      state.pendingRequest=null;
      $("#messageInput").value="";
      updateGuest(next);
      if(!guestHasAccess(next)||(guest.used<next.reminderAt&&next.used>=next.reminderAt))
        openAuth(true,{reminder:true});
    }else{
      const answer=await post("/cases/"+id+"/chat",{message,mode,docIds,requestId});
      state.pendingRequest=null;
      $("#messageInput").value="";
      await loadCases(id);
      if(answer.alreadyProcessed)$("#notice").textContent="Ответ ранее сохранён. Повторное списание не производилось.";
    }
  }catch(e){
    // A reverse-proxy timeout can occur after the model has finished.
    // Reconcile the saved reply before telling the user the request failed.
    if(guest){
      try{
        const latest=await request("/guest");
        updateGuest(latest);
        if(latest.messages.some(x=>x.role==="assistant"&&x.requestId===requestId)){
          state.pendingRequest=null;$("#messageInput").value="";
          $("#notice").textContent="Ответ получен и сохранён; повторного списания нет.";
        }else{
          showError(e.message+" Токены за ответ не списаны. Повторите попытку.");
          if(!guestHasAccess(latest))openAuth(true,{reminder:true});
        }
      }catch{showError(e.message+" Проверьте историю перед повторной отправкой.");}
    }else if(e.status===402){
      await loadCases(id).catch(()=>{});
      showError("Недостаточно токенов для операции. Доступные пакеты показаны в тарифах; оплата пока подключается.");
      showPlans();
    }else{
      try{
        const latest=await request("/cases/"+id);
        if(latest.messages.some(x=>x.role==="assistant"&&x.requestId===requestId)){
          state.pendingRequest=null;$("#messageInput").value="";
          await loadCases(id);
          $("#notice").textContent="Ответ сохранён в деле. Повторное списание не производилось.";
        }else{
          await loadCases(id);
          showError(e.message+" Если ответ появится позже, он сохранится в истории. При повторе того же запроса двойного списания не будет.");
        }
      }catch{showError(e.message+" Не удалось проверить результат; не меняйте текст запроса перед повтором.");}
    }
  }finally{
    clearInterval(progress);
    state.busy=false;
    $("#send").disabled=state.guest?!guestCanSend(state.guest):false;
    $("#send").textContent="Отправить";
  }
});
$("#messageInput").addEventListener("keydown",ev=>{
  if(ev.key==="Enter"&&(ev.ctrlKey||ev.metaKey)){ev.preventDefault();$("#messageForm").requestSubmit();}
});
if(referralFromLink)$("#referralCode").value=referralFromLink;
boot();
