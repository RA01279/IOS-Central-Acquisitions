import {effectiveFact} from './model';
import type {TaxState,TaxRecord} from './types';
import {billAccountMatches} from './bill-account';

/** A valuation, payment, balance or proposed levy never satisfies bill-history coverage. */
export function sourcedBill(state:TaxState,row:TaxRecord){
 const parcel=state.parcels.find(p=>p.key===row.parcelKey);
 if(!parcel||state.records.filter(r=>r.parcelKey===row.parcelKey&&r.year===row.year).length!==1)return false;
 if(!billAccountMatches(parcel,row))return false;
 const fact=effectiveFact(state,row,'levied');
 if(typeof fact?.value!=='number'||!Number.isFinite(fact.value)||fact.stage==='proposed')return false;
 const source=state.sources.find(s=>s.id===fact.sourceId);
 return !!source&&!!source.evidence.trim()&&(source.kind==='official'||source.captureMethod==='user_import')&&(fact.stage==='issued'||row.billEvidence?.sourceId===fact.sourceId)&&
  (source.taxYear===row.year||source.taxYears?.includes(row.year)===true);
}
export function historyCoverage(state:TaxState,now=new Date()){
 const parcels=state.parcels.filter(p=>p.review!=='excluded');
 const bills=state.records.filter(r=>parcels.some(p=>p.key===r.parcelKey)&&r.year<=now.getFullYear()&&sourcedBill(state,r));
 const latest=bills.length?Math.max(...bills.map(r=>r.year)):now.getFullYear();
 const years=Array.from({length:5},(_,i)=>latest-i);
 const accounts=parcels.map(parcel=>{
  const retrieved=years.filter(y=>bills.some(r=>r.parcelKey===parcel.key&&r.year===y));
  return {parcel,retrieved,missing:years.filter(y=>!retrieved.includes(y))};
 });
 const expected=accounts.length*5,retrieved=accounts.reduce((n,p)=>n+p.retrieved.length,0);
 const accountIds=parcels.map(p=>`${p.state}:${p.county.toLowerCase().replace(/ county$/,'')}:${p.accountId.replace(/\s/g,'').toUpperCase()}`);
 const historyComplete=expected>0&&retrieved===expected&&new Set(accountIds).size===accountIds.length;
 const needsReview=parcels.some(p=>p.review!=='included'||p.component==='unknown')||bills.some(r=>!effectiveFact(state,r,'levied')?.reviewed);
 return {latest,years,accounts,expected,retrieved,historyComplete,needsReview,
  title:!state.research?'Research has not run':!historyComplete?'Research finished — historical bills incomplete':needsReview?'Five-year saved account history — review required':'Five-year saved account history'};
}
