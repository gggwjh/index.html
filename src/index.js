import express from "express";
import crypto from "node:crypto";
import { listTasks, getTask, saveTask, deleteTask } from "./store.js";
import { requireAuth } from "./auth.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const maxPrompt = Number(process.env.MAX_PROMPT_CHARS || 12000);
const maxTasks = Number(process.env.MAX_TASKS || 2000);
const timeoutMs = Number(process.env.ENGINE_TIMEOUT_MS || 120000);
const rateWindowMs = 60_000;
const rateLimit = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);
const hits = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use((req,res,next)=>{
  res.setHeader("x-content-type-options","nosniff");
  res.setHeader("x-frame-options","DENY");
  res.setHeader("referrer-policy","no-referrer");
  next();
});
app.use((req,res,next)=>{
  const now=Date.now(), ip=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown").split(",")[0];
  const item=hits.get(ip)||{count:0,at:now};
  if(now-item.at>=rateWindowMs){item.count=0;item.at=now}
  item.count++;
  hits.set(ip,item);
  if(item.count>rateLimit)return res.status(429).json({error:"rate_limit_exceeded"});
  next();
});
app.use(express.static("public"));

const engines = {
  dify:{label:"Dify",url:process.env.DIFY_URL||"",key:process.env.DIFY_API_KEY||"",role:"AI apps, RAG, workflows",path:process.env.DIFY_PATH||"/v1/chat-messages"},
  n8n:{label:"n8n",url:process.env.N8N_URL||"",key:process.env.N8N_API_KEY||"",role:"Automation & integrations",path:process.env.N8N_PATH||"/webhook/ai-os"},
  openhands:{label:"OpenHands",url:process.env.OPENHANDS_URL||"",key:process.env.OPENHANDS_API_KEY||"",role:"Coding & software agents",path:process.env.OPENHANDS_PATH||"/api/tasks"},
  browser_use:{label:"Browser Use",url:process.env.BROWSER_USE_URL||"",key:process.env.BROWSER_USE_API_KEY||"",role:"Browser execution",path:process.env.BROWSER_USE_PATH||"/api/tasks"},
  langgraph:{label:"LangGraph",url:process.env.LANGGRAPH_URL||"",key:process.env.LANGGRAPH_API_KEY||"",role:"Agent orchestration",path:process.env.LANGGRAPH_PATH||"/invoke"}
};

function classify(input=""){
  const text=input.toLowerCase();
  if(/code|برمج|موقع|تطبيق|bug|github|repo|react|python/.test(text))return "openhands";
  if(/browser|متصفح|ابحث|search|website|موقع على الانترنت|scrape|ويب/.test(text))return "browser_use";
  if(/automation|workflow|أتمت|ربط|telegram|whatsapp|webhook/.test(text))return "n8n";
  if(/rag|documents|ملفات|knowledge|معرفة|chatbot|بوت/.test(text))return "dify";
  return "langgraph";
}
function engineSnapshot(){return Object.entries(engines).map(([id,e])=>({id,label:e.label,role:e.role,configured:Boolean(e.url),status:e.url?"configured":"pending_configuration"}))}
function endpoint(engine){return engine.url?new URL(engine.path,engine.url).toString():""}
function headers(engine){const h={"content-type":"application/json"};if(engine.key)h.authorization="Bearer "+engine.key;return h}
function normalizeResult(data){if(data==null)return null;if(typeof data==="string")return data;return data.output??data.result??data.message??data.response??data.data??data}
function publicTask(t){return {...t,metadata:undefined}}
async function executeTask(task){
  const engine=engines[task.engine];
  if(!engine.url){task.status="needs_configuration";task.completedAt=new Date().toISOString();await saveTask(task);return}
  task.status="running";task.startedAt=new Date().toISOString();await saveTask(task);
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    const response=await fetch(endpoint(engine),{method:"POST",headers:headers(engine),signal:controller.signal,body:JSON.stringify({prompt:task.prompt,task_id:task.id,metadata:task.metadata||{}})});
    clearTimeout(timer);
    const raw=await response.text();
    let data;try{data=JSON.parse(raw)}catch{data=raw}
    if(!response.ok)throw new Error("Engine HTTP "+response.status+": "+(typeof data==="string"?data:JSON.stringify(data)));
    task.status="completed";task.completedAt=new Date().toISOString();task.result=normalizeResult(data);task.error=null;
  }catch(error){task.status=error.name==="AbortError"?"timeout":"failed";task.error=error.message;task.completedAt=new Date().toISOString()}
  await saveTask(task);
}
app.get("/health",(_req,res)=>res.json({ok:true,name:process.env.APP_NAME||"AI OS",version:"0.3.0",authRequired:Boolean(process.env.AI_OS_API_KEY),time:new Date().toISOString()}));
app.get("/api/config",requireAuth,(_req,res)=>res.json({name:process.env.APP_NAME||"AI OS",version:"0.3.0",timeoutMs,authRequired:Boolean(process.env.AI_OS_API_KEY),engines:engineSnapshot()}));
app.get("/api/engines",requireAuth,(_req,res)=>res.json({engines:engineSnapshot()}));
app.get("/api/metrics",requireAuth,async(_req,res)=>{
  const tasks=await listTasks();
  const counts=tasks.reduce((a,t)=>(a[t.status]=(a[t.status]||0)+1,a),{});
  res.json({total:tasks.length,counts,configuredEngines:Object.values(engines).filter(e=>e.url).length});
});
app.post("/api/tasks",requireAuth,async(req,res)=>{
  const prompt=String(req.body?.prompt||"").trim();
  if(!prompt)return res.status(400).json({error:"prompt_is_required"});
  if(prompt.length>maxPrompt)return res.status(413).json({error:"prompt_too_long",maxPromptChars:maxPrompt});
  const engine=req.body?.engine&&engines[req.body.engine]?req.body.engine:classify(prompt);
  const task={id:crypto.randomUUID(),prompt,engine,status:"queued",createdAt:new Date().toISOString(),metadata:req.body?.metadata||{},result:null,error:null,attempts:0};
  const tasks=await listTasks();
  if(tasks.length>=maxTasks)return res.status(503).json({error:"task_store_full"});
  await saveTask(task);res.status(202).json(publicTask(task));executeTask(task);
});
app.get("/api/tasks",requireAuth,async(_req,res)=>{const tasks=await listTasks();res.json({tasks:tasks.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicTask)})});
app.get("/api/tasks/:id",requireAuth,async(req,res)=>{const task=await getTask(req.params.id);if(!task)return res.status(404).json({error:"task_not_found"});res.json(publicTask(task))});
app.post("/api/tasks/:id/retry",requireAuth,async(req,res)=>{
  const task=await getTask(req.params.id);if(!task)return res.status(404).json({error:"task_not_found"});
  if(["queued","running"].includes(task.status))return res.status(409).json({error:"task_already_running"});
  task.status="queued";task.error=null;task.result=null;task.completedAt=null;task.attempts=(task.attempts||0)+1;task.retryAt=new Date().toISOString();
  await saveTask(task);executeTask(task);res.status(202).json(publicTask(task));
});
app.delete("/api/tasks/:id",requireAuth,async(req,res)=>{if(!(await deleteTask(req.params.id)))return res.status(404).json({error:"task_not_found"});res.status(204).end()});
app.get("/{*splat}",(_req,res)=>res.sendFile("index.html",{root:"public"}));
app.listen(port,()=>console.log("AI OS running on http://localhost:"+port));
