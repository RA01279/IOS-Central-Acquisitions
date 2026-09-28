import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { searchResult, emailResult } from "./outlook-helper/codex.mjs";
function load(file, deps = {}) {
 const exports = {};
 vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
 { exports, require: name => { if (!(name in deps)) throw Error("Unexpected import " + name); return deps[name]; }, URL, Buffer });
 return exports;
}
const tables = { outlook_helpers: [], outlook_helper_jobs: [] };
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
     if(table==="outlook_helper_jobs"&&tables[table].some(r=>r.helper_id===payload.helper_id&&["queued","processing"].includes(r.status)))
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
const db={from:builder};let email="owner@example.com";
const deps={"node:crypto":crypto,"next/server":{NextResponse:{json:(body,options)=>({body,status:options?.status||200})}},
 "@/lib/auth":{getCurrentUser:async()=>email?{email}:null},"@/lib/supabase":{getServiceClient:()=>db}};
const lib=load("lib/outlook-helper.ts",deps);deps["@/lib/outlook-helper"]=lib;
const browser=load("app/api/outlook-helper/route.ts",deps),worker=load("app/api/outlook-helper/worker/route.ts",deps);
function req(body,options={}) {return {json:async()=>body,text:async()=>JSON.stringify(body),
 nextUrl:new URL("https://hopper.test/api/outlook-helper"+(options.path||"")),
 headers:new Headers({host:"hopper.test",origin:options.origin||"https://hopper.test",...(options.token?{authorization:"Bearer "+options.token}:{})})};}
email=null;assert.equal((await browser.GET(req())).status,401);
email="owner@example.com";assert.equal((await browser.POST(req({action:"pair"},{origin:"https://evil.test"}))).status,403);
const paired=await browser.POST(req({action:"pair"}));assert.equal(paired.status,200);const token=paired.body.token;
assert.notEqual(tables.outlook_helpers[0].token_hash,token);
assert.equal((await worker.GET(req())).status,401);
assert.equal((await worker.GET(req(null,{token}))).body.ownerEmail,email);
let result=await browser.POST(req({action:"enqueue",kind:"search",input:{query:"mixed",fromIndex:0}}));assert.equal(result.status,202);const searchId=result.body.id;
assert.equal((await browser.POST(req({action:"enqueue",kind:"search",input:{query:"again",fromIndex:0}}))).status,409);
const claim=await worker.GET(req(null,{token}));assert.equal(claim.body.job.id,searchId);
assert.equal((await worker.GET(req(null,{token}))).body.job,null,"cannot double-claim");
assert.equal((await worker.POST(req({id:searchId,result:{messages:[{id:"email1",subject:"Mixed comps",preview:"sale and lease",hasAttachments:true}],nextFromIndex:20}},{token}))).status,200);
email="other@example.com";assert.equal((await browser.GET(req(null,{path:"?job="+searchId}))).status,404,"other account cannot read results");
const other=(await browser.POST(req({action:"pair"}))).body.token;
assert.equal((await worker.POST(req({id:searchId,result:{}},{token:other}))).status,404,"another helper cannot complete job");
email="owner@example.com";
assert.equal((await browser.POST(req({action:"enqueue",kind:"fetch",input:{messageId:"unseen",searchJobId:searchId}}))).status,400);
const fetchJob=await browser.POST(req({action:"enqueue",kind:"fetch",input:{messageId:"email1",searchJobId:searchId}}));assert.equal(fetchJob.status,202);
await worker.GET(req(null,{token}));
assert.equal((await worker.POST(req({id:fetchJob.body.id,result:{text:"Address: 1 Main Rd",sourceRef:"Broker email"}},{token}))).status,200);
const completed=await browser.GET(req(null,{path:"?job="+fetchJob.body.id}));assert.equal(completed.body.result.source,"email");
assert.equal((await worker.POST(req({id:fetchJob.body.id,result:{text:"overwrite"}},{token}))).status,409);
await browser.POST(req({action:"pair"}));assert.equal((await worker.GET(req(null,{token}))).status,401,"rotation revokes token");
assert.equal(tables.outlook_helper_jobs.length,0,"rotation purges mailbox data");
await browser.DELETE(req());assert.equal((await browser.GET(req())).body.paired,false);
assert.throws(()=>lib.safeResult("fetch",{text:""}));
assert.throws(()=>lib.safeResult("fetch",{text:"x".repeat(1000001)}));
assert.equal(lib.validInput("send",{query:"x",fromIndex:0}),false);
assert.equal(lib.validInput("search",{query:"x",fromIndex:-1}),false);
const m=searchResult({results:[{id:"1",subject:"Subject",sender:{emailAddress:{address:"broker@example.com"}},has_attachments:true}],has_more:true,next_from_index:17});
assert.equal(m.nextFromIndex,17);assert.equal(m.messages[0].hasAttachments,true);
const body=emailResult({id:"1",subject:"Subject",body:{contentType:"html",content:"**101 Main Road**\nLeased $1 PSF"},sender:{emailAddress:{address:"broker@example.com"}}});
assert.equal(body.html,undefined,"connector Markdown is not HTML");assert.match(body.sourceRef,/broker@example.com/);
assert.ok(emailResult({body:{content:"<table><tr><td>1 Main Rd</td></tr></table>"}}).html);
console.log("PASS: helper auth, CSRF, account isolation, single claim, search selection, completion, rotation, revocation, response validation and connector normalization.");

