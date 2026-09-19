import fs from "node:fs/promises";
import path from "node:path";

const dir=path.resolve(process.env.DATA_DIR||"data");
const file=path.join(dir,"tasks.json");
let state=null;
let queue=Promise.resolve();

async function ensure(){
  await fs.mkdir(dir,{recursive:true});
  try{await fs.access(file)}
  catch{await fs.writeFile(file,"[]","utf8")}
}
async function load(){
  if(state)return state;
  await ensure();
  try{
    const value=JSON.parse(await fs.readFile(file,"utf8"));
    state=Array.isArray(value)?value:[];
  }catch{state=[]}
  return state;
}
function persist(){
  queue=queue.then(async()=>{
    await ensure();
    const tmp=file+"."+process.pid+".tmp";
    await fs.writeFile(tmp,JSON.stringify(state,null,2),"utf8");
    await fs.rename(tmp,file);
  });
  return queue;
}
export async function listTasks(){
  const tasks=await load();
  return tasks.map(t=>({...t}));
}
export async function getTask(id){
  const task=(await load()).find(t=>t.id===id);
  return task?{...task}:null;
}
export async function saveTask(task){
  const tasks=await load();
  const index=tasks.findIndex(t=>t.id===task.id);
  if(index>=0)tasks[index]={...task};
  else tasks.push({...task});
  state=tasks;
  await persist();
  return {...task};
}
export async function deleteTask(id){
  await load();
  const next=state.filter(t=>t.id!==id);
  if(next.length===state.length)return false;
  state=next;
  await persist();
  return true;
}
export async function pruneTasks(max){
  await load();
  if(!Number.isFinite(max)||max<1||state.length<=max)return 0;
  const active=new Set(["queued","running"]);
  const inactive=state.filter(t=>!active.has(t.status)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const remove=Math.min(state.length-max,inactive.length);
  if(remove<=0)return 0;
  const ids=new Set(inactive.slice(0,remove).map(t=>t.id));
  state=state.filter(t=>!ids.has(t.id));
  await persist();
  return remove;
}
