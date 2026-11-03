import {it,expect} from 'vitest';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {processEnv} from '@next/env';
import {getServiceClient} from '../../supabase';
import {loadTaxWorkspace,saveTaxWorkspace,validateTaxState} from '../store';
import {mergeResearch} from '../model';
import {emptyTaxState} from '../types';
import {historyCoverage} from '../coverage';
const root='docs/tax-system-audit-20261026';
it.runIf(process.env.BACKFILL_TAX==='1')('retains audited official originals, saves current tax workspaces, reloads and preserves corrections',async()=>{
 processEnv([{path:'.env.backfill.local',contents:readFileSync('.env.backfill.local','utf8'),env:{}}],process.cwd(),console,true);expect(new URL(process.env.SUPABASE_URL!).hostname).toBe('ylouqbvweldnlveqpeym.supabase.co');const db=getServiceClient();
 const links=JSON.parse(readFileSync(`${root}/current-links.json`,'utf8')),results:any[]=[];
 const files=readdirSync(`${root}/properties`).filter(n=>/^(?:asset-)?[a-f0-9-]{36}\.json$/.test(n));
 for(const file of files)validateTaxState(JSON.parse(readFileSync(`${root}/properties/${file}`,'utf8')).state);
 for(const file of files){const audit=JSON.parse(readFileSync(`${root}/properties/${file}`,'utf8')),asset=audit.subject.id.startsWith('asset-'),link=links.find((r:any)=>r.id===audit.subject.id),kind=asset?'asset':'property',id=asset?audit.subject.id.slice(6):link?.property_id;if(!id)throw Error('Audited subject no longer maps to a current property.');
  try{
   const current=asset?await loadTaxWorkspace(db,`asset:${id}`):await loadTaxWorkspace(db,audit.subject.id),findings=structuredClone(audit.state);
   for(const m of audit.manifest){const source=findings.sources.find((s:any)=>s.id===m.sourceId);if(!source)continue;const bytes=readFileSync(m.file);expect(createHash('sha256').update(bytes).digest('hex')).toBe(m.sha256);const prefix=asset?`property-tax-subjects/asset/${id}`:`deals/${audit.subject.id}/property-taxes`,path=`${prefix}/${source.id}-${m.sha256}.${m.contentType==='application/pdf'?'pdf':'json'}`;
    const upload=await db.storage.from('documents').upload(path,bytes,{contentType:m.contentType,upsert:false});if(upload.error){const stored=await db.storage.from('documents').download(path);if(stored.error||!stored.data||createHash('sha256').update(new Uint8Array(await stored.data.arrayBuffer())).digest('hex')!==m.sha256)throw Error('Original evidence upload did not verify.');}source.storagePath=path;
   }
   const state=validateTaxState(mergeResearch(current.state,findings));expect(state.overrides).toEqual(current.state.overrides);for(const old of current.state.sources)expect(state.sources).toContainEqual(old);
   const saved=await saveTaxWorkspace(db,asset?`asset:${id}`:audit.subject.id,current.revision,state,'tax-system-audit','research');
   const reloaded=await loadTaxWorkspace(db,asset?`asset:${id}`:audit.subject.id);expect(reloaded.revision).toBe(saved.revision);expect(reloaded.state).toEqual(state);
   if(!asset){const old=await db.from('property_tax_subjects').select('revision,state').eq('subject_kind','property').eq('subject_id',id).maybeSingle();if(old.error)throw old.error;const canonical=validateTaxState(mergeResearch(old.data?.state??emptyTaxState(),state)),r=await db.rpc('save_property_tax_subject',{p_kind:'property',p_id:id,p_expected:old.data?.revision??0,p_state:canonical});if(r.error)throw r.error;}
   for(const d of state.research?.discovery??[]){const old=await db.from('property_tax_jurisdictions').select('jurisdiction').eq('jurisdiction',d.jurisdiction).maybeSingle();const data={jurisdiction:d.jurisdiction,discovery:d,updated_at:new Date().toISOString()};const r=old.data?await db.from('property_tax_jurisdictions').update(data).eq('jurisdiction',d.jurisdiction):await db.from('property_tax_jurisdictions').insert({...data,status:d.adapter?'adapter_available':'investigation_open'});if(r.error)throw r.error;}
   const coverage=historyCoverage(state);const update=await db.from('property_tax_jobs').update({status:'needs_review',attempts:0,next_attempt_at:new Date(Date.now()+30*86400000).toISOString(),locked_until:null,lease:null,outcome:{auditAt:audit.finishedAt,savedAt:new Date().toISOString(),accountHistoryComplete:coverage.historyComplete,propertyComplete:coverage.propertyComplete,accounts:state.parcels.length,bills:coverage.retrieved,gaps:state.research?.gaps},updated_at:new Date().toISOString()}).eq('subject_kind',kind).eq('subject_id',id);if(update.error)throw update.error;
   results.push({subject:audit.subject.id,revision:saved.revision,status:'saved-and-reloaded',billRecords:coverage.retrieved,overridesPreserved:state.overrides.length});
  }catch(e){results.push({subject:audit.subject.id,status:'failed',error:String(e)});}
  writeFileSync(`${root}/backfill-results.json`,JSON.stringify(results,null,2));
 }
 expect(results.filter(r=>r.status==='failed')).toEqual([]);expect(results.length).toBe(142);
},1_800_000);
