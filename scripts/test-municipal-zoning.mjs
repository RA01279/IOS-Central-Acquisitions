import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const modules=new Map();
function load(file,extra={}) {
  if(modules.has(file)) return modules.get(file);
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{
    exports,process,URL,URLSearchParams,AbortSignal,Buffer,console,fetch,
    require:n=>n.startsWith("./")?load("lib/zoning/"+n.slice(2)+".ts"):require(n),...extra,
  }); modules.set(file,exports);return exports;
}
const geo=load("lib/zoning/geometry.ts");
const ring=[[0,0],[4,0],[4,4],[0,4],[0,0]];
const polygon={rings:[ring,[[1,1],[1,3],[3,3],[3,1],[1,1]]]};
assert.equal(geo.containsPoint({lng:0.5,lat:0.5},polygon),true);
assert.equal(geo.containsPoint({lng:2,lat:2},polygon),false);
assert.equal(geo.containsPoint({lng:5,lat:2},polygon),false);
const research=load("lib/zoning/research.ts");
const features=(attributes)=>[{attributes,geometry:{rings:[ring]}}];
const layers={boundary:features({NAME:"Plano"}),zoning:features({ZN:"LC",S:"S-500/501"}),overlays:[]};
const subject=research.zoningAt({lat:0.5,lng:0.5},layers);
assert.equal(subject.specialUse,"S-500/501");
assert.equal(research.compareZoning(subject,{...subject,specialUse:""}),"same_base");
assert.equal(research.compareZoning(subject,subject),"same_designation");
assert.equal(research.compareZoning(subject,{...subject,district:"LI-1"}),"different");
assert.equal(research.compareZoning(subject,null),"outside");
assert.equal(research.compareZoning(subject,{...subject,status:"unknown"}),"unknown");
assert.equal(research.zoningAt({lat:0.5,lng:0.5},{...layers,zoning:[...layers.zoning,...layers.zoning]}).status,"ambiguous");
let authenticated=true, dbReads=0, mode;
const route=load("app/api/deals/[id]/zoning/route.ts",{require:n=>({
  "@/lib/auth":{getCurrentUser:async()=>authenticated?{email:"test@example.com"}:null},
  "@/lib/supabase":{getServiceClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>{dbReads++;return {data:{id:"deal",properties:{address:"3104 S Rigsbee",latitude:33.0138832,longitude:-96.6723418,geocode_precision:"rooftop"}}};}})})})})},
  "@/lib/zoning/research":{MunicipalResearchError:research.MunicipalResearchError,researchZoning:async(input,neighbors)=>{mode=neighbors;return {subject};}},
  "next/server":{NextResponse:{json:(data,options)=>({data,status:options?.status??200})}},
}[n])});
const id="20059b5d-dacc-4bbf-90e6-04c93b96e273";
const call=(body)=>route.POST({json:async()=>body},{params:{id}});
assert.equal((await call({action:"lookup",radiusMiles:3})).status,200);assert.equal(mode,false);
assert.equal((await call({action:"neighbors",radiusMiles:3})).status,200);assert.equal(mode,true);
assert.equal((await call({action:"lookup",radiusMiles:99})).status,400);
authenticated=false;assert.equal((await call({action:"lookup",radiusMiles:3})).status,401);assert.equal(dbReads,2);
console.log("PASS: municipal matching, special-use differences, ambiguity, auth, validation and separate read-only lookup.");

modules.delete("lib/zoning/research.ts");
let sourceCalls=0;
const cachedResearch=load("lib/zoning/research.ts",{fetch:async(url)=>{
  sourceCalls++;
  const name=String(url);
  const attributes=name.includes("MunicipalBoundary")?{NAME:"Plano"}:name.includes("OverlayDistricts")?null:{ZN:"LC",S:"S-500/501",IMS_ZONE:"Light Commercial"};
  return {ok:true,json:async()=>({features:attributes?[{attributes}]:[]})};
}});
const cacheInput={dealId:id,address:"3104 S Rigsbee Dr",point:{lat:33.0138832,lng:-96.6723418},precision:"rooftop",radiusMiles:3};
const cachedFirst=await cachedResearch.researchZoning(cacheInput,false);
const cachedStart=performance.now();
const cachedSecond=await cachedResearch.researchZoning(cacheInput,false);
assert.equal(cachedFirst,cachedSecond,"reuse the completed report and original timestamp");
assert.equal(sourceCalls,3,"no repeated source requests");
console.log("PASS: completed report cache; repeat lookup "+(performance.now()-cachedStart).toFixed(3)+" ms (mock sources).");

if(process.argv.includes("--live")) {
  require("@next/env").loadEnvConfig(process.cwd());
  const input={dealId:id,address:"3104 S Rigsbee Dr",point:{lat:33.0138832,lng:-96.6723418},precision:"rooftop",radiusMiles:3};
  const start=performance.now(), lookup=await research.researchZoning(input,false);
  console.log("Subject",JSON.stringify({seconds:(performance.now()-start)/1000,zoning:lookup.subject}));
  assert.equal(lookup.subject.district,"LC");
  assert.equal(lookup.subject.specialUse,"S-500/501");
  const second=performance.now(), report=await research.researchZoning(input,true);
  console.log("Neighbors",JSON.stringify({seconds:(performance.now()-second)/1000,searchCount:report.searchCount,candidates:report.candidates.map(c=>({id:c.placeId,name:c.name,address:c.address,match:c.match,zoning:c.zoning?.district,specialUse:c.zoning?.specialUse,distance:c.distanceMi}))}));
  const third=performance.now();await research.researchZoning(input,true);
  console.log("Cached seconds",((performance.now()-third)/1000).toFixed(3));
  fs.writeFileSync(require("node:path").join(require("node:os").tmpdir(),"hopper-rigsbee-zoning.json"),JSON.stringify(report,null,2));
}

const cities=load("lib/zoning/cities.ts");
const citySubject=cities.cityZoning(cities.CITIES[0],{lat:32.8,lng:-96.8},[{attributes:{LONG_ZONE_DIST:"IM",PD_NUM:null}}],research.pointSource);
assert.equal(research.compareZoning(citySubject,citySubject),"same_code");
assert.equal(research.compareZoning(citySubject,{...citySubject,municipalityId:"another"}),"outside");
assert.equal(cities.cityZoning(cities.CITIES[0],{lat:32.8,lng:-96.8},[],research.pointSource).status,"unknown");
assert.equal(cities.cityZoning(cities.CITIES[0],{lat:32.8,lng:-96.8},[{attributes:{LONG_ZONE_DIST:"IM"}},{attributes:{LONG_ZONE_DIST:"IM"}}],research.pointSource).status,"ambiguous");
console.log("PASS: incomplete modifier coverage cannot become a full-designation match; different municipalities excluded.");
if(process.argv.includes("--cities-live")) {
 require("@next/env").loadEnvConfig(process.cwd());
 for(const [name,lat,lng] of [["Dallas",32.8361837,-96.8813361],["Austin",30.2142932,-97.7126783],["Fort Worth",32.748,-97.33]]) {
  const started=performance.now();
  const report=await research.researchZoning({dealId:id,address:name+" verification point",point:{lat,lng},precision:"manual",radiusMiles:1},process.argv.includes("--neighbors"));
  assert.ok(report.municipality.startsWith(name));
  assert.equal(report.subject.status,"mapped");
  console.log(JSON.stringify({city:report.municipality,code:report.subject.district,candidates:report.candidates.length,seconds:(performance.now()-started)/1000}));
 }
}
