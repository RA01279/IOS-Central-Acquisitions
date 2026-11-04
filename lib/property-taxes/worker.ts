import {createHash} from 'node:crypto';
import {researchTaxes} from './research';
import {mergeResearch} from './model';
import {loadTaxWorkspace,saveTaxWorkspace,validateTaxState} from './store';
import {emptyTaxState} from './types';
import {historyCoverage} from './coverage';
import {siteFootprint,reviewed} from './auto-review-site';
// Server/cron and audited CLI share this worker. All writes use revision checks;
// refresh never deletes evidence, replaces corrections or applies underwriting.
export async function runTaxJob(db:any,fetcher:typeof fetch=fetch){
 const claimed=await db.rpc('claim_property_tax_job');if(claimed.error)throw claimed.error;const job=claimed.data?.[0];if(!job)return null;
 const {subject_kind:kind,subject_id:id,lease}=job;
 async function finish(status:string,outcome:unknown){const r=await db.from('property_tax_jobs').update({status,outcome,attempts:status==='needs_review'?0:job.attempts,locked_until:null,lease:null,next_attempt_at:new Date(Date.now()+(status==='needs_review'?30*86400000:Math.min(60,15*job.attempts)*60000)).toISOString(),updated_at:new Date().toISOString()}).eq('subject_kind',kind).eq('subject_id',id).eq('lease',lease);if(r.error)throw r.error;}
 try{
  const subject=await db.from(kind==='asset'?'assets':'properties').select('*').eq('id',id).maybeSingle();if(subject.error||!subject.data)throw Error('Tax subject unavailable.');
  const p=subject.data,saved=await db.from('property_tax_subjects').select('revision,state').eq('subject_kind',kind).eq('subject_id',id).maybeSingle();if(saved.error)throw saved.error;
  const existing=saved.data?.state??emptyTaxState();
  const findings=await researchTaxes({address:p.address,city:p.city,state:p.state,latitude:p.latitude==null?null:Number(p.latitude),longitude:p.longitude==null?null:Number(p.longitude),precision:p.geocode_precision},existing,()=>{},fetcher,async(source,bytes,contentType)=>{
   const hash=createHash('sha256').update(bytes).digest('hex'),path=`property-tax-subjects/${kind}/${id}/${source.id}-${hash}.${contentType==='application/pdf'?'pdf':'json'}`;
   const upload=await db.storage.from('documents').upload(path,bytes,{contentType,upsert:false});if(upload.error)throw Error('Original county evidence could not be retained.');source.storagePath=path;
  });
  // Abort stale writes when intake changed the property while research ran.
  const active=await db.from('property_tax_jobs').select('lease').eq('subject_kind',kind).eq('subject_id',id).maybeSingle();if(active.error||active.data?.lease!==lease)return {subject:id,status:'superseded'};
  const site=await siteFootprint(p);
  // Clear-cut matches, bills and reconciliations are approved by Hopper (labeled; people review the rest).
  const state=validateTaxState(reviewed(mergeResearch(existing,findings),site)),save=await db.rpc('save_property_tax_subject',{p_kind:kind,p_id:id,p_expected:saved.data?.revision??0,p_state:state});if(save.error)throw save.error;
  if(kind==='property'){
   const deals=await db.from('deals').select('id').eq('property_id',id).neq('stage','archived');if(deals.error)throw deals.error;
   for(const deal of deals.data??[]){const current=await loadTaxWorkspace(db,deal.id),merged=mergeResearch(current.state,structuredClone(findings));
    // Deal download endpoints require evidence under the deal directory. Retain
    // a server-side copy; the subject original and audit snapshot remain intact.
    for(const source of findings.sources.filter(s=>s.storagePath)){
     if(current.state.sources.some((s:any)=>s.id===source.id))continue;
     const path=`deals/${deal.id}/property-taxes/${source.storagePath!.split('/').at(-1)}`;
     if(source.storagePath!==path){const copied=await db.storage.from('documents').copy(source.storagePath,path);if(copied.error){const [a,b]=await Promise.all([db.storage.from('documents').download(source.storagePath),db.storage.from('documents').download(path)]);if(a.error||b.error||createHash('sha256').update(new Uint8Array(await a.data.arrayBuffer())).digest('hex')!==createHash('sha256').update(new Uint8Array(await b.data.arrayBuffer())).digest('hex'))throw Error('Could not retain verified deal evidence copy.');}}
     const target=merged.sources.find(s=>s.id===source.id);if(target)target.storagePath=path;
    }
    await saveTaxWorkspace(db,deal.id,current.revision,reviewed(merged,site),'tax-ingestion','research');
   }
  }
  for(const d of findings.research?.discovery??[]){const prior=await db.from('property_tax_jurisdictions').select('jurisdiction').eq('jurisdiction',d.jurisdiction).maybeSingle();if(prior.error)throw prior.error;
   const record={jurisdiction:d.jurisdiction,discovery:d,updated_at:new Date().toISOString()};const r=prior.data?await db.from('property_tax_jurisdictions').update(record).eq('jurisdiction',d.jurisdiction):await db.from('property_tax_jurisdictions').insert({...record,status:d.adapter?'adapter_available':'investigation_open'});if(r.error)throw r.error;
  }
  const coverage=historyCoverage(state),failed=state.research?.attempts?.some(a=>a.status==='failed'),status=failed&&job.attempts<3?'retry':'needs_review';
  const outcome={at:new Date().toISOString(),accounts:state.parcels.length,bills:coverage.retrieved,expected:coverage.expected,accountHistoryComplete:coverage.historyComplete,propertyComplete:coverage.propertyComplete,gaps:state.research?.gaps??[],discovery:state.research?.discovery??[]};
  await finish(status,outcome);return {subject:id,status,...outcome};
 }catch(e){await finish(job.attempts<3?'retry':'failed',{at:new Date().toISOString(),error:e instanceof Error?e.message:String(e)});return {subject:id,status:'failed',error:e instanceof Error?e.message:String(e)};}
}
