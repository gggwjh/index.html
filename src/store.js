import fs from "node:fs/promises";
import path from "node:path";
const dir=path.resolve("data");
const file=path.join(dir,"tasks.json");
let queue=Promise.resolve();
async function ensure(){await fs.mkdir(dir,{recursive:true});try{await fs.access(file)}catch{await fs.writeFile(file,"[]","utf8")}}
async function read(){await ensure();try{const v=JSON.parse(await fs.readFile(file,"utf8"));return Array.isArray(v)?v:[]}catch{return []}}
function write(tasks){queue=queue.then(async()=>{await ensure();const tmp=file+".tmp";await fs.writeFile(tmp,JSON.stringify(tasks,null,2),"utf8");await fs.rename(tmp,file)});return queue}
export async function listTasks(){return read()}
export async function getTask(id){return (await read()).find(t=>t.id===id)||null}
export async function saveTask(task){const tasks=await read();const i=tasks.findIndex(t=>t.id===task.id);if(i>=0)tasks[i]=task;else tasks.push(task);await write(tasks);return task}
export async function deleteTask(id){const tasks=await read();const next=tasks.filter(t=>t.id!==id);if(next.length===tasks.length)return false;await write(next);return true}
export async function clearTasks(){await write([])}
