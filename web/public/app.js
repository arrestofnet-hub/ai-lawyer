const $ = (selector) => document.querySelector(selector);
const state = { user:null, cases:[], current:null, mode:"consult", docIds:new Set(), busy:false, registered:false, dailyLimit:0 };
const API = "/chat/api";
const MODE_HELP = {
  consult:"Консультация — предварительный разбор и ближайшее действие",
  audit:"Противоречия — сопоставление документов, дат, сумм и позиций сторон",
  strategy:"Стратегия — процессуальные варианты, риски и вторая проверка модели",
  draft:"Документ — проект юридического текста (пока TXT, без Word/PDF)",
  review:"Перепроверка — независимая проверка выводов второй моделью",
};
function updateSelectedCount() {
  const count=state.docIds.size;
  $("#selectedCount").textContent=count
    ? "Выбрано файлов: " + count + " / 3"
    : "Файлы не выбраны";
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
async function boot() {
  try {
    const s=await request("/session");
    if(!s.authenticated) {authView(false);return;}
    state.user=s.user;state.dailyLimit=s.dailyLimit;
    authView(true);$("#who").textContent=s.user.email;
    if(!s.configured) showError("AI-ключ ещё не подключён. Можно подготовить дела и документы.");
    await loadCases();
  } catch(e){authView(false);showError(e.message,"#authError");}
}
async function loadCases(preferredId) {
  const data=await request("/cases");state.cases=data.cases;
  $("#daily").textContent="Запросов сегодня: "+data.usedToday+" / "+state.dailyLimit;
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
    const txt=document.createElement("div");txt.textContent=msg.text;block.append(txt);
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
      copy.addEventListener("click",()=>navigator.clipboard.writeText(msg.text).catch(()=>showError("Копирование недоступно")));
      const save=document.createElement("button");save.className="linkbutton";save.textContent="Сохранить TXT";
      save.addEventListener("click",()=>downloadText(msg.text,"ai-lawyer-analysis.txt"));
      block.append(copy,save);
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
  $("#invite").hidden=!state.registered;
  $("#invite").required=state.registered;
  $("#authSubmit").textContent=state.registered?"Создать аккаунт":"Войти";
  $("#toggleRegister").textContent=state.registered?"У меня уже есть аккаунт":"Регистрация по приглашению";
  $("#authError").textContent="";
});
$("#authForm").addEventListener("submit",async ev=>{
  ev.preventDefault();$("#authError").textContent="";
  const submit=$("#authSubmit");submit.disabled=true;
  try{
    const b={email:$("#email").value,password:$("#password").value};
    if(state.registered) b.invite=$("#invite").value;
    await post("/auth/"+(state.registered?"register":"login"),b);
    $("#password").value="";$("#invite").value="";await boot();
  }catch(e){showError(e.message,"#authError");}finally{submit.disabled=false;}
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
  $("#modeHint").textContent=MODE_HELP[state.mode]||"";
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
boot();
