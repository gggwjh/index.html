const $=s=>document.querySelector(s);
let poller;

async function loadEngines(){
  const r=await fetch("/api/engines"); const d=await r.json();
  $("#engineCount").textContent=d.engines.length+" محركات";
  $("#engines").innerHTML=d.engines.map(e=>`<div class="engine"><i class="${e.configured?"on":""}"></i><div><b>${e.label}</b><small>${e.role}</small></div><span class="status">${e.configured?"متصل":"يحتاج إعداد"}</span></div>`).join("");
}

function statusLabel(s){
  return ({queued:"في الانتظار",running:"قيد التنفيذ",completed:"اكتملت",failed:"فشلت",timeout:"انتهت المهلة",needs_configuration:"تحتاج إعداد"}[s]||s);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
}

async function loadTasks(){
  const r=await fetch("/api/tasks"); const d=await r.json();
  $("#tasks").innerHTML=d.tasks.length?d.tasks.slice(0,8).map(t=>{
    const result=t.result?escapeHtml(typeof t.result==="string"?t.result:JSON.stringify(t.result)):"";
    const err=t.error?escapeHtml(t.error):"";
    return `<div class="task"><div><p>${escapeHtml(t.prompt)}</p><small>${t.id.slice(0,8)} · ${new Date(t.createdAt).toLocaleString("ar-EG")}</small>${result?`<div class="task-result">${result}</div>`:""}${err?`<div class="task-error">${err}</div>`:""}</div><span class="badge">${statusLabel(t.status)}</span></div>`;
  }).join(""):'<div class="task"><p>لسه مفيش مهام. ابدأ من صندوق الأوامر فوق.</p></div>';
}

async function submitTask(){
  const prompt=$("#prompt").value.trim(); if(!prompt)return;
  const button=$("#taskForm button"); button.disabled=true; button.textContent="جاري التشغيل...";
  const engine=$("#engine").value;
  try{
    const r=await fetch("/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt,engine:engine||undefined})});
    if(!r.ok) throw new Error("تعذر إنشاء المهمة");
    $("#prompt").value=""; await loadTasks(); startPolling();
  }catch(e){alert(e.message)}finally{button.disabled=false;button.textContent="تشغيل المهمة ↗";}
}

function startPolling(){
  clearInterval(poller);
  poller=setInterval(async()=>{
    await loadTasks();
    const r=await fetch("/api/tasks"); const d=await r.json();
    if(!d.tasks.some(t=>["queued","running"].includes(t.status))) clearInterval(poller);
  },1500);
}

$("#taskForm").addEventListener("submit",e=>{e.preventDefault();submitTask()});
$("#refresh").onclick=loadTasks;
loadEngines(); loadTasks(); startPolling();
