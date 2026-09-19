import express from "express";
import crypto from "node:crypto";
import { listTasks, getTask, saveTask, deleteTask, pruneTasks } from "./store.js";
import { requireAuth } from "./auth.js";

const app=express();
const port=Number(process.env.PORT||8787);
const maxPrompt=Math.max(100,Number(process.env.MAX_PROMPT_CHARS||12000));
const maxTasks=Math.max(10,Number(process.env.MAX_TASKS||2000));
const maxResult=Math.max(1000,Number(process.env.MAX_RESULT_CHARS||100000));
const timeoutMs=Math.max(1000,Number(process.env.ENGINE_TIMEOUT_MS||120000));
const rateWindowMs=60_000;
const rateLimit=Math.max(1,Number(process.env.RATE_LIMIT_PER_MINUTE||60));
const maxConcurrent=Math.max(1,Number(process.env.MAX_CONCURRENT_TASKS||4));
const maxRetries=Math.max(0,Number(process.env.MAX_RETRIES||3));
const hits=new Map();
const queue=[];
let active=0;

if(process.env.NODE_ENV==="production"&&!process.env.AI_OS_API_KEY){
  throw new Error("AI_OS_API_KEY is required when NODE_ENV=production");
}

app.disable("x-powered-by");
app.use(express.json({limit:"2mb",strict:true}));
app.use((req,res,next)=>{
  res.setHeader("x-content-type-options","nosniff");
  res.setHeader("x-frame-options","DENY");
  res.setHeader("referrer-policy","no-referrer");
  res.setHeader("permissions-policy","camera=(),microphone=(),geolocation=()");
  res.setHeader("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  next();
});
app.use((req,res,next)=>{
  const now=Date.now();
  if(hits.size>5000)for(const [ip,item] of hits)if(now-item.at>rateWindowMs)hits.delete(ip);
  const ip=String(req.socket.remoteAddress||"unknown");
  const item=hits.get(ip)||{count:0,at:now};
  if(now-item.at>=rateWindowMs){item.count=0;item.at=now}
  item.count++;hits.set(ip,item);
  if(item.count>rateLimit)return res.status(429).json({error:"rate_limit_exceeded"});
  next();
});
app.use(express.static("public",{extensions:["html"]}));

const engines={
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
function engineSnapshot(){
  return Object.entries(engines).map(([id,e])=>({id,label:e.label,role:e.role,configured:Boolean(e.url),status:e.url?"configured":"pending_configuration"}));
}
function endpoint(engine){
  if(!engine.url)return "";
  try{return new URL(engine.path,engine.url).toString()}catch{return ""}
}
function headers(engine){
  const h={"content-type":"application/json","accept":"application/json"};
  if(engine.key)h.authorization="Bearer "+engine.key;
  return h;
}
function normalizeResult(data){
  if(data==null)return null;
  if(typeof data==="string")return data;
  return data.output??data.result??data.message??data.response??data.answer??data.data??data;
}
function clampResult(value){
  const text=typeof value==="string"?value:JSON.stringify(value);
  return text.length>maxResult?text.slice(0,maxResult)+"\n[truncated]":value;
}
function publicTask(t){
  const {metadata,...safe}=t;
  return safe;
}
async function executeTask(task){
  const engine=engines[task.engine];
  if(!engine?.url){
    task.status="needs_configuration";
    task.completedAt=new Date().toISOString();
    task.error="Engine endpoint is not configured";
    await saveTask(task);
    return;
  }
  const target=endpoint(engine);
  if(!target){
    task.status="failed";task.error="Invalid engine URL/path";task.completedAt=new Date().toISOString();await saveTask(task);return;
  }
  task.status="running";task.startedAt=new Date().toISOString();await saveTask(task);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(target,{method:"POST",headers:headers(engine),signal:controller.signal,body:JSON.stringify({prompt:task.prompt,task_id:task.id,metadata:task.metadata||{}})});
    const raw=await response.text();
    let data;try{data=JSON.parse(raw)}catch{data=raw}
    if(!response.ok)throw new Error("Engine HTTP "+response.status+": "+(typeof data==="string"?data:JSON.stringify(data)));
    task.status="completed";task.completedAt=new Date().toISOString();task.result=clampResult(normalizeResult(data));task.error=null;
  }catch(error){
    const message=String(error?.message||error).slice(0,2000);
    const transient=error?.name==="AbortError" || /^Engine HTTP 5\d\d:/.test(message) || /fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(message);
    if(transient && (task.attempts||0)<maxRetries){
      task.status="queued";
      task.error=message;
      task.attempts=(task.attempts||0)+1;
      task.retryAt=new Date(Date.now()+Math.min(60000,1000*Math.pow(2,task.attempts))).toISOString();
      await saveTask(task);
      const delay=Math.min(60000,1000*Math.pow(2,task.attempts));
      const retryTimer=setTimeout(()=>enqueue(task),delay);
      retryTimer.unref?.();
      return;
    }
    task.status=error?.name==="AbortError"?"timeout":"failed";
    task.error=message;
    task.completedAt=new Date().toISOString();
  }finally{
    clearTimeout(timer);
    if(task.status!=="queued")await saveTask(task);
  }
}
async function drain(){
  while(active<maxConcurrent&&queue.length){
    const task=queue.shift();active++;
    try{await executeTask(task)}catch(error){task.status="failed";task.error=String(error?.message||error);task.completedAt=new Date().toISOString();try{await saveTask(task)}catch{}}
    finally{active--}
  }
}
function enqueue(task){queue.push(task);void drain().catch(()=>{})}

app.get("/health",(_req,res)=>res.json({ok:true,name:process.env.APP_NAME||"AI OS",version:"1.0.0",authRequired:Boolean(process.env.AI_OS_API_KEY),queue:queue.length,running:active,time:new Date().toISOString()}));
app.get("/ready",async(_req,res)=>{
  try{await listTasks();res.json({ready:true,storage:"ok",configuredEngines:Object.values(engines).filter(e=>e.url).length})}
  catch(error){res.status(503).json({ready:false,error:String(error?.message||error)})}
});
app.get("/api/config",requireAuth,(_req,res)=>res.json({name:process.env.APP_NAME||"AI OS",version:"1.0.0",timeoutMs,maxPromptChars:maxPrompt,maxConcurrent,maxRetries,authRequired:Boolean(process.env.AI_OS_API_KEY),engines:engineSnapshot()}));
app.get("/api/engines",requireAuth,(_req,res)=>res.json({engines:engineSnapshot()}));
app.get("/api/metrics",requireAuth,async(_req,res)=>{
  const tasks=await listTasks();
  const counts=tasks.reduce((a,t)=>(a[t.status]=(a[t.status]||0)+1,a),{});
  res.json({total:tasks.length,counts,configuredEngines:Object.values(engines).filter(e=>e.url).length,queued:queue.length,running:active});
});
app.post("/api/tasks",requireAuth,async(req,res)=>{
  const prompt=typeof req.body?.prompt==="string"?req.body.prompt.trim():"";
  if(!prompt)return res.status(400).json({error:"prompt_is_required"});
  if(prompt.length>maxPrompt)return res.status(413).json({error:"prompt_too_long",maxPromptChars:maxPrompt});
  const requested=req.body?.engine;
  const engine=requested&&engines[requested]?requested:classify(prompt);
  const metadata=req.body?.metadata&&typeof req.body.metadata==="object"&&!Array.isArray(req.body.metadata)?req.body.metadata:{};
  await pruneTasks(maxTasks-1);
  const current=await listTasks();
  if(current.length>=maxTasks)return res.status(503).json({error:"task_store_full"});
  const task={id:crypto.randomUUID(),prompt,engine,status:"queued",createdAt:new Date().toISOString(),metadata,result:null,error:null,attempts:0};
  await saveTask(task);res.status(202).json(publicTask(task));enqueue(task);
});
app.get("/api/tasks",requireAuth,async(_req,res)=>{
  const tasks=await listTasks();
  res.json({tasks:tasks.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(publicTask)});
});
app.get("/api/tasks/:id",requireAuth,async(req,res)=>{
  const task=await getTask(req.params.id);if(!task)return res.status(404).json({error:"task_not_found"});res.json(publicTask(task));
});
app.post("/api/tasks/:id/retry",requireAuth,async(req,res)=>{
  const task=await getTask(req.params.id);if(!task)return res.status(404).json({error:"task_not_found"});
  if(["queued","running"].includes(task.status))return res.status(409).json({error:"task_already_running"});
  if((task.attempts||0)>=maxRetries)return res.status(409).json({error:"retry_limit_reached",maxRetries});
  task.status="queued";task.error=null;task.result=null;task.completedAt=null;task.attempts=(task.attempts||0)+1;task.retryAt=new Date().toISOString();
  await saveTask(task);enqueue(task);res.status(202).json(publicTask(task));
});
app.delete("/api/tasks/:id",requireAuth,async(req,res)=>{if(!(await deleteTask(req.params.id)))return res.status(404).json({error:"task_not_found"});res.status(204).end()});

app.use((error,_req,res,_next)=>{
  if(error?.type==="entity.parse.failed")return res.status(400).json({error:"invalid_json"});
  if(error?.type==="entity.too.large")return res.status(413).json({error:"request_too_large"});
  res.status(500).json({error:"internal_server_error"});
});
app.get("/{*splat}",(_req,res)=>res.sendFile("index.html",{root:"public"}));

const server=app.listen(port,()=>console.log(`AI OS running on http://localhost:${port}`));
function shutdown(signal){
  console.log(`${signal}: shutting down`);
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on("SIGTERM",()=>shutdown("SIGTERM"));
process.on("SIGINT",()=>shutdown("SIGINT"));
export { app, server, classify };
