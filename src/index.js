import express from "express";
import crypto from "node:crypto";

const app = express();
const port = Number(process.env.PORT || 8787);
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const engines = {
  dify: { label:"Dify", url:process.env.DIFY_URL||"", key:process.env.DIFY_API_KEY||"", role:"AI apps, RAG, workflows", path:process.env.DIFY_PATH||"/v1/chat-messages" },
  n8n: { label:"n8n", url:process.env.N8N_URL||"", key:process.env.N8N_API_KEY||"", role:"Automation & integrations", path:process.env.N8N_PATH||"/webhook/ai-os" },
  openhands: { label:"OpenHands", url:process.env.OPENHANDS_URL||"", key:process.env.OPENHANDS_API_KEY||"", role:"Coding & software agents", path:process.env.OPENHANDS_PATH||"/api/tasks" },
  browser_use: { label:"Browser Use", url:process.env.BROWSER_USE_URL||"", key:process.env.BROWSER_USE_API_KEY||"", role:"Browser execution", path:process.env.BROWSER_USE_PATH||"/api/tasks" },
  langgraph: { label:"LangGraph", url:process.env.LANGGRAPH_URL||"", key:process.env.LANGGRAPH_API_KEY||"", role:"Agent orchestration", path:process.env.LANGGRAPH_PATH||"/invoke" }
};

const tasks = new Map();

function classify(input="") {
  const text=input.toLowerCase();
  if(/code|برمج|موقع|تطبيق|bug|github|repo|react|python/.test(text)) return "openhands";
  if(/browser|متصفح|ابحث|search|website|موقع على الانترنت|scrape|ويب/.test(text)) return "browser_use";
  if(/automation|workflow|أتمت|ربط|telegram|whatsapp|webhook/.test(text)) return "n8n";
  if(/rag|documents|ملفات|knowledge|معرفة|chatbot|بوت/.test(text)) return "dify";
  return "langgraph";
}

function engineSnapshot(){
  return Object.entries(engines).map(([id,e])=>({id,label:e.label,role:e.role,configured:Boolean(e.url),status:e.url?"configured":"pending_configuration"}));
}

function endpoint(engine){
  return engine.url ? new URL(engine.path, engine.url).toString() : "";
}

function headers(engine){
  const h={"content-type":"application/json"};
  if(engine.key) h.authorization="Bearer "+engine.key;
  return h;
}

function normalizeResult(engine,data){
  if(data==null) return null;
  if(typeof data==="string") return data;
  return data.output ?? data.result ?? data.message ?? data.response ?? data.data ?? data;
}

async function executeTask(task){
  const engine=engines[task.engine];
  if(!engine.url){task.status="needs_configuration";return;}
  task.status="running"; task.startedAt=new Date().toISOString();
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),Number(process.env.ENGINE_TIMEOUT_MS||120000));
    const response=await fetch(endpoint(engine),{method:"POST",headers:headers(engine),signal:controller.signal,body:JSON.stringify({prompt:task.prompt,task_id:task.id,metadata:task.metadata||{}})});
    clearTimeout(timeout);
    const raw=await response.text();
    let data; try{data=JSON.parse(raw)}catch{data=raw}
    if(!response.ok) throw new Error("Engine HTTP "+response.status+": "+(typeof data==="string"?data:JSON.stringify(data)));
    task.status="completed"; task.completedAt=new Date().toISOString(); task.result=normalizeResult(engine,data);
  }catch(error){
    task.status=error.name==="AbortError"?"timeout":"failed";
    task.error=error.message; task.completedAt=new Date().toISOString();
  }
}

app.get("/health",(_req,res)=>res.json({ok:true,name:process.env.APP_NAME||"AI OS",version:"0.2.0",time:new Date().toISOString()}));
app.get("/api/engines",(_req,res)=>res.json({engines:engineSnapshot()}));
app.get("/api/config",(_req,res)=>res.json({name:process.env.APP_NAME||"AI OS",version:"0.2.0",timeoutMs:Number(process.env.ENGINE_TIMEOUT_MS||120000),engines:engineSnapshot()}));

app.post("/api/tasks",async(req,res)=>{
  const prompt=String(req.body?.prompt||"").trim();
  if(!prompt) return res.status(400).json({error:"prompt is required"});
  const engine=req.body?.engine&&engines[req.body.engine]?req.body.engine:classify(prompt);
  const task={id:crypto.randomUUID(),prompt,engine,status:"queued",createdAt:new Date().toISOString(),metadata:req.body?.metadata||{},result:null,error:null};
  tasks.set(task.id,task); res.status(202).json(task); executeTask(task);
});

app.get("/api/tasks",(_req,res)=>res.json({tasks:[...tasks.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}));
app.get("/api/tasks/:id",(req,res)=>{
  const task=tasks.get(req.params.id); if(!task) return res.status(404).json({error:"task not found"}); res.json(task);
});
app.delete("/api/tasks/:id",(req,res)=>{
  if(!tasks.delete(req.params.id)) return res.status(404).json({error:"task not found"}); res.status(204).end();
});

app.get("/{*splat}",(_req,res)=>res.sendFile("index.html",{root:"public"}));
app.listen(port,()=>console.log("AI OS running on http://localhost:"+port));
