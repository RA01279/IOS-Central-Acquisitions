import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,deps={}) { const exports={}; vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:n=>deps[n]});return exports; }
const location=load('lib/location.ts');
let row, writes=0, authenticated=true;
const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:row})})}),update:patch=>({eq:()=>({select:()=>({single:async()=>{writes++;row={...row,...patch};return {data:row};}})})})})};
const route=load('app/api/comps/[id]/route.ts',{'@/lib/location':location,'@/lib/auth':{getCurrentUser:async()=>authenticated?{email:'test@example.com'}:null},'@/lib/supabase':{getServiceClient:()=>db},'@/lib/geocode':{geocodeAddress:async()=>{throw new Error('Pin must not be geocoded');}},'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}}});
const patch=body=>route.PATCH({json:async()=>body},{params:{id:'test'}});
for(const type of ['lease','sale']) {
 row={id:'test',comp_type:type,address:'Test',latitude:30,longitude:-95,rent:1000,rent_basis:'total_monthly',date_commenced:'2026-09-01',sale_price:1000000,closed_on:'2026-09-01'};
 for(const body of [{latitude:'bad',longitude:-96},{latitude:'',longitude:-96},{latitude:true,longitude:-96},{latitude:32},{latitude:0,longitude:0},{latitude:91,longitude:-96}]) {const before=writes;assert.equal((await patch(body)).status,400);assert.equal(writes,before);}
 const saved=await patch({latitude:'32.0817',longitude:'-81.1256'});assert.equal(saved.status,200);assert.equal(saved.body.comp.latitude,32.0817);assert.equal(saved.body.comp.longitude,-81.1256);assert.equal(saved.body.comp.geocode_precision,'manual');assert.ok(location.locationReady(saved.body.comp));
 await patch({notes:'Unrelated edit'});assert.equal(row.latitude,32.0817);assert.equal(row.geocode_precision,'manual');
}
authenticated=false;assert.equal((await patch({latitude:30,longitude:-95})).status,401);
console.log('PASS: lease and sale coordinate writes, map eligibility, unrelated edits, invalid input, and authentication.');
if(process.argv.includes('--database')) {
 const {default:nextEnv}=await import('@next/env');nextEnv.loadEnvConfig(process.cwd());
 const ref=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
 const query=`begin;
 do $$ declare c public.comps%rowtype; t text; begin
 foreach t in array array['lease','sale'] loop
 select * into strict c from public.comps where comp_type=t limit 1 for update;
 update public.comps set latitude=32.0817,longitude=-81.1256,geocode_precision='manual',geocoded_at=now() where id=c.id;
 if not exists(select 1 from public.comps where id=c.id and latitude=32.0817 and longitude=-81.1256 and geocode_precision='manual') then raise exception 'Location did not persist for %',t; end if;
 end loop; end $$;
 select 'PASS: lease and sale pins written and read back; transaction rolled back' as result;
 rollback;
 select comp_type,count(*) as total,count(*) filter(where latitude is not null and longitude is not null and geocode_precision in ('manual','supplied','rooftop','range_interpolated','geometric_center')) as located from public.comps group by comp_type;`;
 const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
 if(!response.ok) throw new Error('Database verification failed: '+response.status+' '+await response.text());
 console.log(await response.text());
}
