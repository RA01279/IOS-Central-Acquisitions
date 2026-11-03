import {normalizedAccount} from './accounts';
import {expectedCollectorAccount} from './bill-account';
import type {TaxParcel,TaxSource,TaxRecord} from './types';
// Declarative transcription from retained originals, not OCR or unattended
// verification. Unknown county layouts need no property-specific parser.
export function importAssistedBills(raw:string,parcel:TaxParcel,originals:TaxSource[],existing:TaxRecord[]=[]){
 if(raw.length>100000)throw Error('Assisted manifest is too large.');let rows:any;try{rows=JSON.parse(raw);}catch{throw Error('Enter the assisted bill manifest as JSON.');}
 if(!Array.isArray(rows)||!rows.length||rows.length>10)throw Error('Import one to ten explicit annual records.');
 const sources:TaxSource[]=[],records:TaxRecord[]=[];const years=new Set<number>();
 for(const row of rows){
  if(!Number.isInteger(row.year)||row.year<1900||row.year>new Date().getFullYear()||years.has(row.year))throw Error('Use distinct actual tax years.');years.add(row.year);
  if(normalizedAccount(String(row.account??''))!==normalizedAccount(parcel.accountId))throw Error('Manifest account must match the selected parcel. Record collector aliases in the original bill details.');
  if(!Array.isArray(row.bills)||!row.bills.length||row.bills.length>30)throw Error('Every year needs its original bills.');
  const ids=new Set<string>(),superseded=new Set<string>(),authorities=new Set<string>();let total=0;
  for(const bill of row.bills){
   if(typeof bill.id!=='string'||!bill.id.trim()||bill.id.length>100||ids.has(bill.id))throw Error('Each bill needs its unique printed bill/revision identifier.');ids.add(bill.id);
   const original=originals.find(s=>s.id===bill.originalSourceId&&s.storagePath);if(!original)throw Error('Attach each original PDF or page capture before transcribing it.');
   if(typeof bill.url!=='string'||!/^https?:\/\//i.test(bill.url)||bill.url.length>4000||!Number.isFinite(Date.parse(bill.retrievedAt)))throw Error('Each original needs its exact official source URL and actual retrieval date.');
   if(typeof bill.collector!=='string'||!bill.collector.trim()||typeof bill.collectorAccount!=='string'||!bill.collectorAccount.trim())throw Error('Name the collector and the account printed on every bill.');
   if(!['issued','revised','supplemental'].includes(bill.version))throw Error('Identify issued, revised or supplemental bill status.');
   if(bill.supersedes){if(typeof bill.supersedes!=='string'||bill.supersedes===bill.id)throw Error('Invalid bill supersession.');superseded.add(bill.supersedes);}
   if(bill.supersedes&&bill.version!=='revised')throw Error('Only an explicitly revised bill can supersede another bill.');
   if(bill.version==='revised'&&!bill.supersedes)throw Error('A revised bill must explicitly identify the superseded bill.');
  }
  for(const old of superseded)if(!ids.has(old))throw Error('Retain the superseded original in this manifest; do not silently discard it.');
  for(const b of row.bills){const chain=new Set<string>();let current=b;while(current?.supersedes){if(chain.has(current.id))throw Error('Cyclic bill supersession.');chain.add(current.id);const prior=row.bills.find((x:any)=>x.id===current.supersedes);if(prior.collector!==current.collector||normalizedAccount(prior.collectorAccount)!==normalizedAccount(current.collectorAccount))throw Error('A revised bill cannot supersede a different collector or account.');current=prior;}}
  const prior=existing.find(r=>r.parcelKey===parcel.key&&r.year===row.year&&r.facts.levied);const priorSource=prior&&originals.find(s=>s.id===prior.facts.levied?.sourceId);let required:string[]=[];
  if(priorSource?.storagePath)required=[priorSource.id];else if(priorSource?.captureMethod==='user_import'){try{const old=JSON.parse(priorSource.evidence);required=old.bills?.map((b:any)=>b.originalSourceId)??[];}catch{}}
  if(required.some(id=>!row.bills.some((b:any)=>b.originalSourceId===id)))throw Error('Include the previously saved original bills and explicitly resolve revisions before replacing the annual account amount.');
  const active=row.bills.filter((b:any)=>!superseded.has(b.id));if(!active.length)throw Error('Bill supersession has no active original.');
  const expected=expectedCollectorAccount(parcel);
  const primary=active.find((b:any)=>expected!==null&&normalizedAccount(b.collectorAccount)===expected);
  if(!primary)throw Error('An active original must carry the verified primary collector account for this parcel. Verify its collector alias before importing.');
  for(const bill of active){if(!Array.isArray(bill.authorities)||!bill.authorities.length)throw Error('Transcribe the authority levy rows separately from payments, fees and balances.');
   let subtotal=0;const billAuthorities=new Set<string>();for(const a of bill.authorities){if(typeof a.name!=='string'||!a.name.trim()||typeof a.levied!=='number'||!Number.isFinite(a.levied)||a.levied<0)throw Error('Authority name and explicit billed amount required; unknown must not become zero.');const key=a.name.trim().toLowerCase().replace(/\s+/g,' ');if(billAuthorities.has(key)||authorities.has(key)&&bill.version!=='supplemental')throw Error('An authority appears on multiple active bills. Resolve joint collection or supersession before adding it.');billAuthorities.add(key);authorities.add(key);subtotal+=Math.round(a.levied*100);}
   if(typeof bill.total!=='number'||Math.round(bill.total*100)!==subtotal)throw Error('Authority charges must reconcile exactly to each printed bill total.');total+=subtotal;
  }
  const source:TaxSource={id:crypto.randomUUID(),label:`Assisted official-record transcription — ${parcel.accountId}, ${row.year} (review required)`,url:active[0].url,retrievedAt:new Date().toISOString(),taxYear:row.year,kind:'manual',captureMethod:'user_import',evidence:JSON.stringify({method:'Assisted transcription from retained originals; not unattended verification',account:row.account,year:row.year,bills:row.bills,activeBillIds:active.map((b:any)=>b.id),note:row.note??''})};
  if(source.evidence.length>60000)throw Error('Annual manifest exceeds the evidence limit.');sources.push(source);
  records.push({parcelKey:parcel.key,year:row.year,facts:{levied:{value:total/100,sourceId:source.id,stage:'reported',reviewed:false}},jurisdictions:[],billEvidence:{kind:'collector_history',sourceId:source.id,collectorAccount:primary.collectorAccount,obligationStatus:'unverified',scope:'Active bills and named authority levies in the assisted manifest; parcel and authority completeness require independent review.',notes:'Original attachments, official URLs, capture dates, collector accounts, authority amounts, revisions and supplements retained in the source manifest. Payments and balances were not used as levies.'}});
 }
 return {sources,records};
}
