import {expect,it} from 'vitest';
import {taxFixture,reviewFixture} from './fixtures';
import {obligationReviewProblem,recordObligationReview} from '../obligation-review';
import {annualTotal,mergeResearch} from '../model';
import {historyCoverage} from '../coverage';
import {validateTaxState} from '../store';
function reviewed(){const s=taxFixture();s.sources[0].kind='official';return reviewFixture(s);}
it('a reconciled flag alone cannot close an annual total; retained authority review can, including Harris separate-collector checks',()=>{
 const s=taxFixture();expect(annualTotal(s,2026,'levied').total).toBeNull();
 s.parcels[0].county='Harris';s.records[0].billEvidence!.kind='collector_history';
 reviewFixture(s);expect(annualTotal(s,2026,'levied').total).toBe(2000);
 expect(validateTaxState(JSON.parse(JSON.stringify(s))).records[0].obligationReview).toEqual(s.records[0].obligationReview);
});
it('requires underlying originals, exact authority totals, separate-collector/version notes, actual dates and non-temporary bills',()=>{
 const s=reviewed(),row=s.records[0],valid=row.obligationReview!;
 for(const patch of [{sourceIds:[]},{authorities:[{name:'County',levied:1999,sourceId:s.sources[0].id}]},{separateCollectors:''},{revisions:''},{asOf:'2999-01-01'}])
  expect(()=>recordObligationReview(s,row,{...valid,...patch})).toThrow();
 delete s.sources[0].storagePath;expect(()=>recordObligationReview(s,row,valid)).toThrow(/retained original/);
 s.sources[0].storagePath='retained.pdf';row.facts.appeal={value:'Temporary bill under appeal',stage:'issued',reviewed:true,sourceId:s.sources[0].id};
 expect(()=>recordObligationReview(s,row,valid)).toThrow(/temporary/i);
});
it('requires a retained final record to resolve a temporary bill through an explicit status correction',()=>{
 const s=reviewed(),row=s.records[0],input=row.obligationReview!;
 row.billEvidence!.obligationStatus='temporary';row.facts.appeal={value:'Temporary bill under appeal',stage:'issued',reviewed:true,sourceId:s.sources[0].id};
 const final={...s.sources[0],id:'final-original',evidence:'Synthetic final determination',storagePath:'deals/test/property-taxes/final.pdf'};s.sources.push(final);
 s.overrides.push({parcelKey:row.parcelKey,year:row.year,metric:'appeal',value:'Final issued record; appeal resolved',sourceId:final.id,reason:'Synthetic official final record confirms resolution',stage:'issued'});
 expect(()=>recordObligationReview(s,row,input)).toThrow(/final record supporting/);
 const next=recordObligationReview(s,row,{...input,sourceIds:[s.sources[0].id,final.id],revisions:'Final issued record retained; superseded temporary original retained'});
 expect(obligationReviewProblem(next,next.records[0])).toBeNull();
 expect(next.records[0].facts.appeal?.value).toContain('Temporary');expect(next.overrides).toEqual(s.overrides);
});
it('preserves the old review and corrections but invalidates closure on changed identity, levy, source or authority breakdown',()=>{
 const s=reviewed(),incoming=taxFixture();incoming.records=[];incoming.research={at:new Date().toISOString(),status:'partial',gaps:['Portal blocked']};
 const blocked=JSON.parse(JSON.stringify(mergeResearch(s,incoming)));expect(obligationReviewProblem(blocked,blocked.records[0])).toBeNull();
 for(const mutate of [
  (x:typeof s)=>{x.parcels[0].assessmentGroup='changed';},
  (x:typeof s)=>{x.records[0].facts.levied!.value=2100;},
  (x:typeof s)=>{x.records[0].facts.levied!.sourceId='changed';},
  (x:typeof s)=>{x.records[0].jurisdictions.push({name:'New authority',levied:100,rate:1,unit:'per_100',taxable:null,exemption:null,sourceId:x.sources[0].id,stage:'adopted'});},
 ]){const changed=structuredClone(s);mutate(changed);expect(obligationReviewProblem(changed,changed.records[0])).not.toBeNull();expect(annualTotal(changed,2026,'levied').total).toBeNull();expect(changed.records[0].obligationReview).toEqual(s.records[0].obligationReview);}
});
it('only complete reviewed parcel/account/year/authority evidence yields property completeness',()=>{
 const s=reviewed();s.sources[0].taxYears=[2026,2025,2024,2023,2022];
 s.records=Array.from({length:5},(_,i)=>({...structuredClone(s.records[0]),year:2026-i}));
 for(let i=0;i<5;i++)reviewFixture(s,i);
 expect(historyCoverage(s).propertyComplete).toBe(true);
 delete s.records[3].obligationReview;expect(historyCoverage(s).propertyComplete).toBe(false);
 reviewFixture(s,3);delete s.scopeReview;expect(historyCoverage(s).propertyComplete).toBe(false);
});
it('parcel coverage cannot survive a changed acquisition identity or an unattached boundary link',()=>{
 const s=reviewed();expect(historyCoverage(s).parcelSetVerified).toBe(true);
 s.parcels[0].legal='Changed acquisition boundary';expect(historyCoverage(s).parcelSetVerified).toBe(false);
 reviewFixture(s);delete s.sources[0].storagePath;expect(historyCoverage(s).parcelSetVerified).toBe(false);
});
it('preserves an assisted combined bill set and its corrections when an automatic collector subtotal refreshes',()=>{
 const s=taxFixture(),original={...s.sources[0],id:'attachment',storagePath:'deals/test/property-taxes/official.pdf'};
 const manifest={...s.sources[0],id:'assisted',captureMethod:'user_import' as const,evidence:JSON.stringify({bills:[{originalSourceId:'attachment'}]})};
 s.sources.push(original,manifest);s.records[0].facts.levied!.sourceId=manifest.id;s.records[0].billEvidence!.sourceId=manifest.id;
 s.records=recordObligationReview(s,s.records[0],{asOf:'2026-10-21T00:00:00Z',note:'County and separately collected city combined',separateCollectors:'Distinct county and city originals checked',revisions:'Final versions confirmed',sourceIds:[original.id],authorities:[{name:'County + city',levied:2000,sourceId:original.id}]}).records;
 const incoming=taxFixture();incoming.sources[0].kind='official';incoming.sources[0].id='auto-original';
 incoming.records[0].facts.levied={...incoming.records[0].facts.levied!,value:1000,sourceId:'auto-original'};incoming.records[0].billEvidence!.sourceId='auto-original';
 incoming.research={at:new Date().toISOString(),status:'partial',gaps:[]};
 const merged=mergeResearch(s,incoming);
 expect(merged.records[0].facts.levied!.value).toBe(2000);expect(merged.records[0].facts.levied!.sourceId).toBe('assisted');
 expect(merged.records[0].obligationReview?.invalidatedBy).toContain('collector source');expect(annualTotal(merged,2026,'levied').total).toBeNull();
 expect(merged.research!.gaps.join(' ')).toContain('assisted bill set');expect(merged.sources).toContainEqual(original);
});
