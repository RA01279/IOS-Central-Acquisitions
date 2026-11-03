import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {researchTaxes} from '../research';
import {emptyTaxState} from '../types';
import {historyCoverage} from '../coverage';
const root='docs/tax-system-audit-20261026';
it.runIf(process.env.PORTFOLIO_TAX==='1')('audits current deals and portfolio assets against official sources with retained originals',async()=>{
 const deals=JSON.parse(readFileSync(`${root}/inventory.json`,'utf8')).filter((r:any)=>r.stage!=='archived');
 const assets=JSON.parse(readFileSync(`${root}/assets.json`,'utf8')).filter((r:any)=>r.status!=='sold').map((r:any)=>({...r,id:`asset-${r.id}`}));
 const rows=[...deals,...assets].filter((p:any)=>{if(!process.env.TAX_AUDIT_COUNTY)return true;const file=`${root}/properties/${p.id}.json`;return existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).state?.parcels.some((a:any)=>a.county.toLowerCase()===process.env.TAX_AUDIT_COUNTY!.toLowerCase());});mkdirSync(`${root}/properties`,{recursive:true});let cursor=0;
 async function worker(){while(cursor<rows.length){const p=rows[cursor++],file=`${root}/properties/${p.id}.json`;if(existsSync(file)&&!process.env.TAX_AUDIT_REFRESH&&!process.env.TAX_AUDIT_COUNTY)continue;
  const manifest:any[]=[];const startedAt=new Date().toISOString();
  const fetcher:typeof fetch=async(input,init)=>{await new Promise(r=>setTimeout(r,350));let response=await fetch(input,init);if([429,502,503,504].includes(response.status)){await new Promise(r=>setTimeout(r,3000));response=await fetch(input,init);}return response;};
  try{const state=await researchTaxes({address:p.address,city:p.city,state:p.state,latitude:p.latitude==null?null:Number(p.latitude),longitude:p.longitude==null?null:Number(p.longitude),precision:p.geocode_precision},emptyTaxState(),()=>{},fetcher,async(source,bytes,type)=>{
   const hash=createHash('sha256').update(bytes).digest('hex'),path=`${root}/properties/${p.id}-${hash}.${type==='application/pdf'?'pdf':'json'}`;writeFileSync(path,bytes);manifest.push({sourceId:source.id,url:source.url,at:source.retrievedAt,sha256:hash,file:path,contentType:type});
  });const coverage=historyCoverage(state);writeFileSync(file,JSON.stringify({subject:p,startedAt,finishedAt:new Date().toISOString(),manifest,state,coverage},null,2));console.log(JSON.stringify({id:p.id,address:p.address,accounts:state.parcels.length,bills:coverage.retrieved,attempts:state.research?.attempts?.map(a=>a.status)}));}
  catch(e){writeFileSync(file,JSON.stringify({subject:p,startedAt,error:String(e),manifest},null,2));}
 }}
 // Two subjects maximum; each account's collector session is strictly sequential.
 await Promise.all([worker(),worker()]);
 expect(rows.every((p:any)=>existsSync(`${root}/properties/${p.id}.json`))).toBe(true);
},7_200_000);
