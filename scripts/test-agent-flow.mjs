import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { searchResult, emailResult } from "./outlook-helper/codex.mjs";
function load(file, deps = {}) {
 const exports = {};
 vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
 { exports, require: name => { if (!(name in deps)) throw Error("Unexpected import " + name); return deps[name]; }, URL, Buffer, Date, console });
 return exports;
}
const tables = { outlook_helpers: [], outlook_helper_jobs: [], agent_runs: [], deals: [], sourcing_sweeps: [] };
function builder(table) {
 let filters = [], op = "select", payload, selection = false, max = Infinity;
 const b = {
 select() { selection = true; return b; },
 eq(k,v) { filters.push(r=>r[k]===v); return b; }, gt(k,v) { filters.push(r=>r[k]>v); return b; },
 lt(k,v) { filters.push(r=>r[k]<v); return b; }, in(k,v) { filters.push(r=>v.includes(r[k])); return b; },
 order() { return b; }, limit(n) { max=n; return b; },
 insert(v) {op="insert";payload=v;return b;},upsert(v) {op="upsert";payload=v;return b;},
 update(v) {op="update";payload=v;return b;},delete() {op="delete";return b;},
 single() {return execute(true);},maybeSingle() {return execute(true);},then(a,z) {return execute(false).then(a,z);}
 };
 async function execute(single) {
   let rows = tables[table].filter(r=>filters.every(f=>f(r))).slice(0,max);
   if(op==="insert"||op==="upsert") {
     if(["outlook_helper_jobs","agent_runs"].includes(table)&&tables[table].some(r=>r.helper_id===payload.helper_id&&["queued","processing"].includes(r.status)))
       return {error:{code:"23505"},data:null};
     let row=op==="upsert"?tables[table].find(r=>r.owner_email===payload.owner_email):null;
     if(row)Object.assign(row,payload);
     else {row={id:crypto.randomUUID(),created_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString(),status:"queued",...payload};tables[table].push(row);}
     rows=[row];
   }
   if(op==="update") rows.forEach(r=>Object.assign(r,payload));
   if(op==="delete") {
     tables[table]=tables[table].filter(r=>!rows.includes(r));
     if(table==="outlook_helpers")tables.outlook_helper_jobs=tables.outlook_helper_jobs.filter(r=>!rows.some(h=>h.id===r.helper_id));
   }
   return {data:single?(rows[0]?structuredClone(rows[0]):null):structuredClone(rows),error:null};
 }
 return b;
}
const db={from:builder}; let email="owner@example.com";
const json=(body,status=200)=>({body,status});
const deps={"node:crypto":crypto,"next/server":{after:fn=>{globalThis.__afterCalls=(globalThis.__afterCalls||[]);globalThis.__afterCalls.push(fn);},NextResponse:{json:(body,options)=>({body,status:options?.status||200})}},
 "@/lib/auth":{getCurrentUser:async()=>email?{email}:null},"@/lib/supabase":{getServiceClient:()=>db}};
const helper=load("lib/outlook-helper.ts",deps); deps["@/lib/outlook-helper"]=helper;
const lib=load("lib/agents/server.ts",deps); deps["@/lib/agents/server"]=lib;
deps["./memo"]=deps["@/lib/agents/memo"]=load("lib/agents/memo.ts",deps);
deps["./ic-narrative"]=deps["@/lib/agents/ic-narrative"]=load("lib/agents/ic-narrative.ts",deps);
deps["./sourcing"]=deps["@/lib/agents/sourcing"]=load("lib/agents/sourcing.ts",deps);
deps["./identity"]=load("lib/sourcing/identity.ts",deps);
deps["@/lib/sourcing/snapshot"]=load("lib/sourcing/snapshot.ts",deps);
deps["@/lib/sourcing/fit"]=load("lib/sourcing/fit.ts",deps);
for (const m of ["deal-import","comp-import","portfolio-import","market-report","market-narrative"]) deps["./"+m]=deps["@/lib/agents/"+m]=load("lib/agents/"+m+".ts",deps);
deps["@/lib/agents/catalog"]=load("lib/agents/catalog.ts",deps);
const autoCalls=[];deps["@/lib/ic-deck/auto"]={autoExecSummary:async(...a)=>{autoCalls.push(a);}};
deps["@/lib/agents/context"]={loadEvidence:async()=>[{label:"Synthetic test",data:{address:"123 Example Road"}}]};
const browser=load("app/api/agents/route.ts",deps),worker=load("app/api/agents/worker/route.ts",deps);
function req(body,options={}) {return {text:async()=>JSON.stringify(body),nextUrl:new URL("https://hopper.test/api/agents"+(options.path||"")),headers:new Headers({host:"hopper.test",origin:options.origin||"https://hopper.test",...(options.token?{authorization:"Bearer "+options.token}:{})})};}
const token=crypto.randomBytes(32).toString('base64url');
tables.outlook_helpers.push({id:crypto.randomUUID(),owner_email:email,token_hash:helper.helperTokenHash(token),expires_at:new Date(Date.now()+86400000).toISOString()});
assert.equal((await worker.GET(req())).status,401);
await worker.GET(req(null,{token}));
const created=await browser.POST(req({agent:"deal-intake",text:"Synthetic source: 123 Example Road, five acres."})); assert.equal(created.status,202);
const id=created.body.id;
assert.equal((await browser.POST(req({agent:"deal-intake",text:"Another source"}))).status,409);
const claimed=await worker.GET(req(null,{token})); assert.equal(claimed.body.job.id,id);
assert.equal((await worker.GET(req(null,{token}))).body.job,null);
assert.equal((await worker.POST(req({id,result:{report:"",model:"test",limitations:[]}},{token}))).status,400);
assert.equal((await worker.POST(req({id,result:{report:"Synthetic report",model:"test",limitations:["Unverified"]},usage:{input_tokens:10,output_tokens:3}},{token}))).status,200);
assert.equal((await browser.GET(req(null,{path:"?id="+id}))).body.result.report,"Synthetic report");
assert.equal((await worker.POST(req({id,result:{report:"Overwrite",model:"test",limitations:[]}},{token}))).status,409);
email="other@example.com";
assert.equal((await browser.GET(req(null,{path:"?id="+id}))).status,404);
email="owner@example.com";
const next=await browser.POST(req({agent:"pipeline-follow-up",text:""})); assert.equal(next.status,202);
tables.agent_runs.find(r=>r.id===next.body.id).created_at=new Date(Date.now()-21*60000).toISOString();
await lib.reap(db,email); assert.equal(tables.agent_runs.find(r=>r.id===next.body.id).status,"failed");
// Qualification uses the owner's saved review, never browser-supplied facts.
const sweepId=crypto.randomUUID();
const reviewedSite=(ref,ownerClass)=>({ref,lat:29.87,lng:-95.55,address:'100 Reviewed Yard Rd',known:null,parcel:ownerClass?{ownerClass}:null,operators:[],categories:[]});
tables.sourcing_sweeps.push({id:sweepId,owner_email:email,snapshot:{label:'Reviewed Houston',market:'Houston',sites:[reviewedSite('S1','public'),reviewedSite('S2',null)]}});
const sourcingRequest={agent:'off-market-sourcing',text:'UNTRUSTED BROWSER LOCATION',sweepId,refs:['S1','S2'],buyBox:{minAcres:2,maxAcres:10,maxCoveragePct:30}};
assert.equal((await browser.POST(req({...sourcingRequest,refs:['S9']}))).status,400);
email='other@example.com';assert.equal((await browser.POST(req(sourcingRequest))).status,400);email='owner@example.com';
const queue=async()=>{const r=await browser.POST(req(sourcingRequest));assert.equal(r.status,202);return (await worker.GET(req(null,{token}))).body.job;};
let job=await queue();
assert.ok(job.prompt.includes('100 Reviewed Yard Rd'));assert.ok(!job.prompt.includes('UNTRUSTED BROWSER LOCATION'));
const site=ref=>({ref,ownerType:'unknown',outdoorStorage:'unverified',fit:'strong',fitReason:'Agent claim',outreach:'',signals:[],sources:[],unverified:[]});
const complete=async(sites)=>{assert.equal((await worker.POST(req({id:job.id,result:{report:JSON.stringify({version:'sourcing-v1',sites}),model:'test',limitations:[]}},{token}))).status,200);return tables.agent_runs.find(r=>r.id===job.id);};
assert.equal((await complete([site('S1')])).status,'failed','missing reviewed references fail qualification');
job=await queue();
const sourced=await complete([site('S1'),site('S2')]);assert.equal(sourced.status,'completed');
const checked=JSON.parse(sourced.result.report).sites;
assert.equal(checked[0].ownerType,'public');assert.equal(checked[0].fit,'poor');
assert.equal(checked[1].fit,'unknown','an agent cannot claim strong fit without usable area and footprint');
assert.equal((await browser.GET(req(null,{path:'?id='+job.id}))).body.sources.find(s=>s.label==='Reviewed sourcing sites v2').data.sites.length,2);
tables.outlook_helpers[0].expires_at=new Date(Date.now()-1000).toISOString();
assert.equal((await worker.GET(req(null,{token}))).status,401);
console.log("PASS: enqueue, single claim, duplicate prevention, malformed result rejection, saved report retrieval, owner isolation, timeout and pairing expiry.");
