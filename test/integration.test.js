import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.NODE_ENV="test";
process.env.PORT="0";
process.env.AI_OS_API_KEY="test-key";
process.env.DATA_DIR="data-test";

const { server }=await import("../src/index.js");
const port=server.address().port;
const base="http://127.0.0.1:"+port;

test("health endpoint is public",async()=>{
  const response=await fetch(base+"/health");
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.ok,true);
});

test("protected API rejects missing key",async()=>{
  const response=await fetch(base+"/api/tasks");
  assert.equal(response.status,401);
});

test("task lifecycle works without an external engine",async()=>{
  const create=await fetch(base+"/api/tasks",{method:"POST",headers:{"content-type":"application/json","x-api-key":"test-key"},body:JSON.stringify({prompt:"اختبار"} )});
  assert.equal(create.status,202);
  const task=await create.json();
  assert.equal(task.status,"queued");
  await new Promise(r=>setTimeout(r,150));
  const get=await fetch(base+"/api/tasks/"+task.id,{headers:{"x-api-key":"test-key"}});
  assert.equal(get.status,200);
  const saved=await get.json();
  assert.equal(saved.status,"needs_configuration");
});

after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  await fs.rm("data-test",{recursive:true,force:true});
});
