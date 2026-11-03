import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {discoverTaxSources,jurisdictionKey} from '../discovery';
const root='docs/tax-system-audit-20261026';
it.runIf(process.env.DISCOVERY_SWEEP==='1')('investigates every current jurisdiction and retains official directory chains',async()=>{
 const files=readdirSync(`${root}/properties`).filter(n=>/^(?:asset-)?[a-f0-9-]{36}\.json$/.test(n));const rows=files.map(file=>({file,data:JSON.parse(readFileSync(`${root}/properties/${file}`,'utf8'))}));const jurisdictions=new Map<string,{state:string;county:string}>();
 for(const {data} of rows){for(const p of data.state?.parcels??[])jurisdictions.set(jurisdictionKey(p.state,p.county),p);for(const s of data.state?.sources??[]){if(!s.label.includes('Census county'))continue;try{const e=JSON.parse(s.evidence),county=e.counties?.[0]?.BASENAME,state=e.states?.[0]?.STUSAB;if(county&&state)jurisdictions.set(jurisdictionKey(state,county),{state,county});}catch{}}}
 mkdirSync(`${root}/discovery`,{recursive:true});const discoveries:any[]=[];
 for(const [key,p] of jurisdictions){const manifest:any[]=[];const r=await discoverTaxSources(p.state,p.county,fetch,async(source,bytes,type)=>{const hash=createHash('sha256').update(bytes).digest('hex'),file=`${root}/discovery/${key.replace(':','-')}-${hash}.json`;writeFileSync(file,bytes);manifest.push({sourceId:source.id,file,sha256:hash,url:source.url,at:source.retrievedAt,contentType:type});},true);discoveries.push({...r,manifest});await new Promise(r=>setTimeout(r,500));}
 writeFileSync(`${root}/discovery/results.json`,JSON.stringify(discoveries,null,2));
 for(const {file,data} of rows){if(!data.state?.research)continue;const ids=new Set((data.state.parcels??[]).map((p:any)=>jurisdictionKey(p.state,p.county)));for(const s of data.state.sources){if(!s.label.includes('Census county'))continue;try{const e=JSON.parse(s.evidence);ids.add(jurisdictionKey(e.states[0].STUSAB,e.counties[0].BASENAME));}catch{}}
 const matches=discoveries.filter(r=>ids.has(r.discovery.jurisdiction));data.state.research.discovery=matches.map(r=>r.discovery);for(const r of matches){data.state.sources.push(...r.sources);data.manifest.push(...r.manifest);}writeFileSync(`${root}/properties/${file}`,JSON.stringify(data,null,2));}
 expect(discoveries.length).toBeGreaterThan(5);console.log(JSON.stringify(discoveries.map(r=>({jurisdiction:r.discovery.jurisdiction,status:r.discovery.status,links:r.discovery.officialLinks.length}))));
},900000);
