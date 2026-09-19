import express from "express";
import crypto from "node:crypto";

const app = express();
const port = Number(process.env.PORT || 8787);
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const engines = {
  dify: { label: "Dify", url: process.env.DIFY_URL || "", role: "AI apps, RAG, workflows" },
  n8n: { label: "n8n", url: process.env.N8N_URL || "", role: "Automation & integrations" },
  openhands: { label: "OpenHands", url: process.env.OPENHANDS_URL || "", role: "Coding & software agents" },
  browser_use: { label: "Browser Use", url: process.env.BROWSER_USE_URL || "", role: "Browser execution" },
  langgraph: { label: "LangGraph", url: process.env.LANGGRAPH_URL || "", role: "Agent orchestration" }
};

const tasks = new Map();

function classify(input="") {
  const text = input.toLowerCase();
  if (/code|برمج|موقع|تطبيق|bug|github|repo|react|python/.test(text)) return "openhands";
  if (/browser|متصفح|ابحث|search|website|موقع على الانترنت|scrape/.test(text)) return "browser_use";
  if (/automation|workflow|أتمت|ربط|telegram|whatsapp|webhook/.test(text)) return "n8n";
  if (/rag|documents|ملفات|knowledge|معرفة|chatbot|بوت/.test(text)) return "dify";
  return "langgraph";
}

function engineSnapshot() {
  return Object.entries(engines).map(([id,e]) => ({
    id, label:e.label, role:e.role,
    configured:Boolean(e.url),
    status:e.url ? "configured" : "pending_configuration"
  }));
}

app.get("/health", (_req,res)=>res.json({ok:true,name:process.env.APP_NAME||"AI OS",time:new Date().toISOString()}));
app.get("/api/engines", (_req,res)=>res.json({engines:engineSnapshot()}));

app.post("/api/tasks", (req,res)=>{
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({error:"prompt is required"});
  const engine = req.body?.engine && engines[req.body.engine] ? req.body.engine : classify(prompt);
  const id = crypto.randomUUID();
  const task = {
    id, prompt, engine, status: engines[engine].url ? "queued" : "needs_configuration",
    createdAt:new Date().toISOString(),
    result: engines[engine].url ? null : "Connect the selected engine endpoint in .env to execute this task."
  };
  tasks.set(id,task);
  res.status(201).json(task);
});

app.get("/api/tasks", (_req,res)=>{
  res.json({tasks:[...tasks.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
});

app.get("/api/tasks/:id",(req,res)=>{
  const task=tasks.get(req.params.id);
  if(!task) return res.status(404).json({error:"task not found"});
  res.json(task);
});

app.get("*", (_req,res)=>res.sendFile("index.html",{root:"public"}));

app.listen(port,()=>console.log(`AI OS running on http://localhost:${port}`));
