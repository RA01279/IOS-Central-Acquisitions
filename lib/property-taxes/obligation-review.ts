import type {TaxState,TaxRecord,TaxObligationReview} from './types';
import {billAccountMatches} from './bill-account';

function levy(state:TaxState,row:TaxRecord){
 const override=state.overrides.find(o=>o.parcelKey===row.parcelKey&&o.year===row.year&&o.metric==='levied');
 return override?{value:override.value,sourceId:override.sourceId,stage:override.stage??'reported',reviewed:true}:row.facts.levied;
}
function appeal(state:TaxState,row:TaxRecord){return state.overrides.find(o=>o.parcelKey===row.parcelKey&&o.year===row.year&&o.metric==='appeal')??row.facts.appeal;}
export function obligationBasis(state:TaxState,row:TaxRecord){
 const p=state.parcels.find(p=>p.key===row.parcelKey),f=levy(state,row),b=row.billEvidence;
 return JSON.stringify({parcel:p&&[p.key,p.accountId,p.state,p.county,p.address,p.legal,p.assessmentGroup,p.component],year:row.year,
  levy:f&&[f.value,f.sourceId,f.stage],bill:b&&[b.sourceId,b.collectorAccount,b.kind],appeal:appeal(state,row),
  authorities:row.jurisdictions.map(j=>[j.name,j.levied,j.sourceId])});
}
function problem(state:TaxState,row:TaxRecord,review:TaxObligationReview){
 if(review.invalidatedBy)return 'Newly retrieved official evidence requires reconciliation: '+review.invalidatedBy;
 const parcel=state.parcels.find(p=>p.key===row.parcelKey),f=levy(state,row);
 if(!parcel||parcel.review!=='included'||!billAccountMatches(parcel,row))return 'Include and verify the parcel and its collector account first.';
 if(!row.billEvidence||typeof f?.value!=='number'||!Number.isFinite(f.value)||f.value<0||!['issued','reported'].includes(f.stage)||!f.reviewed)return 'Review a source-supported issued or reported levy first.';
 const appealFact=appeal(state,row),appealOverride=state.overrides.find(o=>o.parcelKey===row.parcelKey&&o.year===row.year&&o.metric==='appeal');
 if(row.billEvidence.obligationStatus==='temporary'&&!appealOverride||/temporary bill|under appeal/i.test(String(appealFact?.value??'')))return 'A temporary or appeal bill needs a final record and an explicit resolution before annual reconciliation.';
 if(!Number.isFinite(Date.parse(review.at))||!Number.isFinite(Date.parse(review.asOf))||Date.parse(review.asOf)>Date.now()||Date.parse(review.asOf)>Date.parse(review.at))return 'Use actual review and as-of dates.';
 if(!review.note?.trim()||!review.separateCollectors?.trim()||!review.revisions?.trim())return 'Explain authority scope, separate collectors, and revised or supplemental bill checks.';
 if(!review.sourceIds?.length||review.sourceIds.length>50||new Set(review.sourceIds).size!==review.sourceIds.length)return 'Select retained original evidence.';
 const proof=review.sourceIds.map(id=>state.sources.find(s=>s.id===id));
 if(appealOverride&&(!String(appealOverride.value??'').trim()||!review.sourceIds.includes(appealOverride.sourceId)))return 'Retain the final record supporting the appeal-status correction in this annual review.';
 if(proof.some(s=>!s?.storagePath||!s.evidence.trim()||!Number.isFinite(Date.parse(s.retrievedAt))))return 'Every review source must have a retained original and retrieval date.';
 const source=state.sources.find(s=>s.id===f.sourceId);
 if(source&&source.kind!=='official'&&source.captureMethod!=='user_import')return 'Use official issued records or an assisted original-bill manifest for the effective levy.';
 if(!source||!(source.taxYear===row.year||source.taxYears?.includes(row.year)))return 'The levy source must explicitly identify this tax year.';
 const required=source.storagePath?[source.id]:[];
 if(source.captureMethod==='user_import'){
  try {const manifest=JSON.parse(source.evidence);if(!Array.isArray(manifest.bills)||!manifest.bills.length)return 'Attach the original bills underlying the imported history before reconciliation.';required.push(...manifest.bills.map((b:any)=>b.originalSourceId));}
  catch{return 'The imported levy lacks its original-bill manifest.';}
 }
 if(!required.length||required.some(id=>!review.sourceIds.includes(id)))return 'Include every underlying bill original, including superseded versions.';
 if(!review.authorities?.length||review.authorities.length>50)return 'List each distinct taxing authority once, including jointly collected authorities.';
 const keys=new Set<string>();let cents=0;
 for(const a of review.authorities){
  const key=a.name?.trim().toLowerCase().replace(/\s+/g,' ');
  if(!key||keys.has(key)||!review.sourceIds.includes(a.sourceId)||typeof a.levied!=='number'||!Number.isFinite(a.levied)||a.levied<0||Math.abs(a.levied*100-Math.round(a.levied*100))>0.00001)return 'Use distinct authority names, explicit cent amounts and retained evidence for each authority.';
  keys.add(key);cents+=Math.round(a.levied*100);
 }
 if(cents!==Math.round(f.value*100))return 'Authority levies must reconcile exactly to the effective annual levy. Correct or combine the bills before reviewing.';
 if(review.basis!==obligationBasis(state,row))return 'Identity, levy or source evidence changed; repeat the annual reconciliation.';
 return null;
}
export function obligationReviewProblem(state:TaxState,row:TaxRecord){
 return row.obligationReview?problem(state,row,row.obligationReview):'Annual authority and revised/supplemental bill scope is unverified.';
}
export function recordObligationReview(state:TaxState,row:TaxRecord,input:Omit<TaxObligationReview,'at'|'basis'|'invalidatedBy'>):TaxState{
 const review={asOf:input.asOf,note:input.note,separateCollectors:input.separateCollectors,revisions:input.revisions,sourceIds:input.sourceIds,authorities:input.authorities,at:new Date().toISOString(),basis:obligationBasis(state,row)};
 const issue=problem(state,row,review);if(issue)throw Error(issue);
 return {...state,records:state.records.map(r=>r!==row?r:{...r,obligationReview:review,billEvidence:{...r.billEvidence!,obligationStatus:'reconciled'}})};
}
