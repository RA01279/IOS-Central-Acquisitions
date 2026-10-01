import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
nextEnv.loadEnvConfig(process.cwd());
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync("lib/geocode.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,process,fetch,URL,AbortSignal});
const rows=[];for(;;){const {data,error}=await db.from("comps").select("id,address,city,state,market,latitude,longitude,geocode_precision").order("id").range(rows.length,rows.length+499);if(error)throw Error(error.message);if(!data.length)break;rows.push(...data);}
const cache=new Map();const results=[];let next=0;
await Promise.all(Array.from({length:4},async()=>{for(;;){const i=next++;if(i>=rows.length)return;const row=rows[i];const key=JSON.stringify([row.address,row.city,row.state,row.market]);if(!cache.has(key))cache.set(key,exports.geocodeAddress([row.address,row.city,row.market],{state:row.state,requirePrecise:true}));const g=await cache.get(key);let distance=null;if(g){const r=x=>x*Math.PI/180;const a=Math.sin(r(g.lat-Number(row.latitude))/2)**2+Math.cos(r(g.lat))*Math.cos(r(Number(row.latitude)))*Math.sin(r(g.lng-Number(row.longitude))/2)**2;distance=3958.7613*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}results.push({...row,google:g,distanceMiles:distance});}}));
const discrepant=results.filter(r=>r.distanceMiles>0.5);
writeFileSync("docs/comp-pin-accuracy.json",JSON.stringify({checked:rows.length,googleMatched:results.filter(r=>r.google).length,discrepant,notIndependentlyVerified:results.filter(r=>!r.google).map(({google,distanceMiles,...r})=>r)},null,2));
console.log(JSON.stringify({checked:rows.length,googleMatched:results.filter(r=>r.google).length,discrepant},null,2));
