const $=s=>document.querySelector(s);
let poller;
const API_KEY=sessionStorage.getItem("ai_os_key")||"";
$("#apiKey").value=API_KEY;

async function api(path,options={}){
  const headers=new Headers(options.headers||{});
  if(API_KEY)headers.set("x-api-key",API_KEY);
  const r=await fetch(path,{...options,headers});
  if(r.status===401)throw new Error("المصادقة مطلوبة — ضيف مفتاح API من الإعدادات");
  return r;
}
async function loadEngines(){
  const r=await api("/api/engines");const d=await r.json();
  $("#engineCount").textContent=d.engines.length+" محركات";
  $("#enginesList").innerHTML=d.engines.map(e=>`<div class="engine"><i class="${e.configured?"on":""}"></i><div><b>${escapeHtml(e.label)}</b><small>${escapeHtml(e.role)}</small></div><span class="status">${e.configured?"متصل":"يحتاج إعداد"}</span></div>`).join("");
}
function statusLabel(s){return ({queued:"في الانتظار",running:"قيد التنفيذ",completed:"اكتملت",failed:"فشلت",timeout:"انتهت المهلة",needs_configuration:"تحتاج إعداد"}[s]||s)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
async function loadTasks(){
  const r=await api("/api/tasks");const d=await r.json();
  $("#tasksList").innerHTML=d.tasks.length?d.tasks.map(t=>{const result=t.result?escapeHtml(typeof t.result==="string"?t.result:JSON.stringify(t.result)):"";const err=t.error?escapeHtml(t.error):"";return `<div class="task"><div><p>${escapeHtml(t.prompt)}</p><small>${t.id.slice(0,8)} · ${new Date(t.createdAt).toLocaleString("ar-EG")} · ${escapeHtml(t.engine)}</small>${result?`<div class="task-result">${result}</div>`:''}${err?`<div class="task-error">${err}</div>`:''}</div><div class="task-actions"><span class="badge">${statusLabel(t.status)}</span>${["failed","timeout","needs_configuration"].includes(t.status)?`<button data-retry-id="${t.id}">إعادة</button>`:''}</div></div>`}).join(""):'<div class="task"><p>لسه مفيش مهام. ابدأ من الصفحة الرئيسية.</p></div>';
}
async function loadMetrics(){
  try{const r=await api("/api/metrics");const d=await r.json();$("#total").textContent=d.total;$("#running").textContent=d.counts.running||0;$("#completed").textContent=d.counts.completed||0;$("#configured").textContent=d.configuredEngines+"/5";}catch{}
}
async function loadHealth(){try{const r=await fetch("/health");const d=await r.json();$("#healthText").textContent=d.ok?"النظام جاهز":"النظام غير متاح"}catch{$("#healthText").textContent="غير متصل"}}
async function submitTask(){
  const prompt=$("#prompt").value.trim();if(!prompt)return;
  const button=$("#taskForm button");button.disabled=true;button.textContent="جاري التشغيل...";
  try{const engine=$("#engine").value;const r=await api("/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt,engine:engine||undefined})});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"تعذر إنشاء المهمة")}$("#prompt").value="";await loadTasks();await loadMetrics();startPolling()}catch(e){alert(e.message)}finally{button.disabled=false;button.textContent="تشغيل المهمة ↗"}
}
async function retryTask(id){try{await api("/api/tasks/"+id+"/retry",{method:"POST"});await loadTasks();startPolling()}catch(e){alert(e.message)}}
function startPolling(){clearInterval(poller);poller=setInterval(async()=>{try{await Promise.all([loadTasks(),loadMetrics()]);const r=await api("/api/tasks");const d=await r.json();if(!d.tasks.some(t=>["queued","running"].includes(t.status)))clearInterval(poller)}catch{clearInterval(poller)}},1500)}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{document.querySelectorAll(".view").forEach(v=>v.classList.remove("active-view"));$("#"+b.dataset.view).classList.add("active-view");document.querySelectorAll("[data-view]").forEach(x=>x.classList.remove("active"));b.classList.add("active")});
$("#taskForm").addEventListener("submit",e=>{e.preventDefault();submitTask()});
$("#refresh").onclick=()=>Promise.all([loadTasks(),loadMetrics()]);
$("#saveKey").onclick=()=>{sessionStorage.setItem("ai_os_key",$("#apiKey").value.trim());location.reload()};
$("#clearKey").onclick=()=>{sessionStorage.removeItem("ai_os_key");$("#apiKey").value=""};
Promise.all([loadHealth(),loadEngines(),loadTasks(),loadMetrics()]).catch(e=>console.error(e));
startPolling();


$("#tasksList").addEventListener("click",e=>{const button=e.target.closest("[data-retry-id]");if(button)retryTask(button.dataset.retryId)});
