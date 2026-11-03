// Explicit local-only UI fixture. No environment files, network database, or production auth.
import {createServer} from 'vite';import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd();
const deal={id:'11111111-1111-4111-8111-111111111111',stage:'uw',assigned_analyst:'Fixture analyst',investment_review:null,properties:{address:'100 Fixture Yard Rd',city:'Testville',building_sf:16000,lot_sf:8.7*43560,occupancy_status:'vacant'},asking_price:8500000,uw_versions:[{id:'v1',deal_id:'11111111-1111-4111-8111-111111111111',version_number:1,created_at:'2026-10-16',returns_summary:{sourceProperty:'200 Different Yard Rd',purchasePrice:7500000,irrPct:.2293},model_detail:{uw:{year1Noi:637776}}}],offers:[],uw_runs:[]};
deal.deal_analysis_versions=[];
const events=[];
class Query {
 filters=[];patch=null;
 constructor(table){this.table=table;}
 select(){return this;}order(){return this;}limit(){return this;}
 eq(k,v){this.filters.push(r=>r[k]&&typeof r[k]==='object'?JSON.stringify(r[k])===(typeof v==='string'?v:JSON.stringify(v)):r[k]===v);return this;}
 is(k,v){this.filters.push(r=>r[k]==v);return this;}update(p){this.patch=p;return this;}
 rows(){const pool=this.table==='deals'?[deal]:this.table==='deal_analysis_versions'?deal.deal_analysis_versions:deal.uw_versions;const rows=pool.filter(r=>this.filters.every(f=>f(r)));if(this.patch)for(const row of rows)Object.assign(row,structuredClone(this.patch));return structuredClone(rows);}
 async maybeSingle(){return{data:this.rows()[0]??null,error:null};}then(resolve,reject){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}
}
const fixtureDb={from:t=>new Query(t),rpc:async(name,args)=>{if(name!=='save_deal_analysis')throw new Error('Unexpected fixture RPC');const latest=deal.deal_analysis_versions[0];if((latest?.version??0)!==args.p_expected)return{error:{message:'Stale fixture review'}};const row={deal_id:deal.id,kind:args.p_kind,version:(latest?.version??0)+1,payload:args.p_payload,created_at:new Date().toISOString(),created_by:args.p_actor};deal.deal_analysis_versions.unshift(row);return{data:row,error:null};}};
const cache={};function load(file){file=path.resolve(file);if(!path.extname(file))file+='.ts';if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const req=id=>{if(id==='@/lib/auth')return{getCurrentUser:async()=>({email:'fixture@localhost'})};if(id==='@/lib/supabase')return{getServiceClient:()=>fixtureDb};if(id==='@/lib/deals')return{logDealEvent:async(...args)=>events.push(args)};if(id.startsWith('@/'))return load(path.join(root,id.slice(2)));if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id));return require(id);};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText)(req,m,m.exports);return m.exports;}
const handler=load('app/api/deals/[id]/investment-review/route.ts');
const analysis=load('app/api/deals/[id]/analysis/route.ts');
const NextRequest=require('next/server').NextRequest;
const server=await createServer({root:path.join(root,'tests/investment-browser'),envDir:path.join(root,'tests/investment-browser'),server:{host:'127.0.0.1',port:3197,strictPort:true,fs:{allow:[root]}},resolve:{alias:{'@':root,'next/navigation':path.join(root,'tests/investment-browser/navigation.ts'),'next/link':path.join(root,'tests/investment-browser/link.tsx')}},esbuild:{jsx:'automatic'},plugins:[{name:'isolated-fixture-api',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{try{
 if(req.url==='/fixture/deal'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(deal));}
 if(req.url==='/fixture/events')return res.end(JSON.stringify(events));
 if(req.url?.includes('/analysis')||req.url?.endsWith('/investment-review')){
  let body='';for await(const part of req)body+=part;
  const request=new NextRequest('http://localhost'+req.url,{method:req.method,...(req.method==='POST'?{body}:{})});
  const target=req.url.includes('/analysis')?analysis:handler;
  const result=await target[req.method](request,{params:Promise.resolve({id:deal.id})});res.writeHead(result.status,{'Content-Type':'application/json'});return res.end(await result.text());
 }
 if(req.url?.startsWith('/api/')){res.writeHead(404,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Not available in isolated fixture'}));}next();
 }catch(e){res.statusCode=500;res.end(String(e));}});}}]});
await server.listen();console.log('Isolated fixture: http://127.0.0.1:3197 — no production credentials or data');
