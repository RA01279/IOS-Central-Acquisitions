import {annualTotal,effectiveFact} from './model';
import type {TaxState,Metric} from './types';
export const taxMoney=(value:number|null)=>value===null?'Unavailable':value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
/** Source evidence remains visible before review; excluded neighbors never headline the subject. */
export function subjectRecords(state:TaxState){return state.records.filter(r=>state.parcels.some(p=>p.key===r.parcelKey&&p.review!=='excluded')).sort((a,b)=>b.year-a.year||a.parcelKey.localeCompare(b.parcelKey));}
export function taxAvailability(state:TaxState){
 const records=subjectRecords(state),bills=records.filter(r=>effectiveFact(state,r,'levied')?.value!=null);
 if(bills.length)return {kind:'bill' as const,title:'Dated bill / levy evidence retrieved',detail:'Imported account figures are shown below. Combined totals require parcel coverage and figure review. A bill does not establish current payments or outstanding balance.'};
 if(records.length)return {kind:'assessment' as const,title:'Parcel / valuation evidence only — no tax bill retrieved',detail:'Market value is not a tax bill. Assessed value, taxable value, levies and payment history remain unavailable unless separately sourced. Review the source gaps below.'};
 if(state.research)return {kind:'gap' as const,title:'Research ran; no subject tax figures retrieved',detail:'This is an explicit coverage gap. Retry official sources or retain a dated official record manually. Do not interpret missing values as zero.'};
 return {kind:'not-run' as const,title:'Tax research has not run for this property',detail:'Adding a property does not automatically research taxes. Use Research / retry official sources. Available information depends on the county connector; unsupported sources are disclosed.'};
}
export function combinedDisplay(state:TaxState,year:number,metric:Metric){
 try{const result=annualTotal(state,year,metric);if(result.total!==null)return taxMoney(result.total);
  if(state.parcels.some(p=>p.review==='pending'))return 'Parcel review required';
  if(!state.parcels.some(p=>p.review==='included'))return 'No subject accounts included';
  return `Missing or unreviewed figure${result.knownSubtotal?` (${taxMoney(result.knownSubtotal)} reviewed subtotal)`:''}`;
 }catch(e){return e instanceof Error?e.message:'Parcel coverage review required';}
}
