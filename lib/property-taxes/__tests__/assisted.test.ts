import {it,expect} from 'vitest';
import {importAssistedBills} from '../assisted';
import {parcel,source} from './fixtures';
import {billAccountMatches} from '../bill-account';
const originals=[{...source,id:'scan',kind:'upload' as const,storagePath:'deals/test/property-taxes/original.pdf'}];
const bill={id:'issued-1',originalSourceId:'scan',url:'https://county.example.gov/record',retrievedAt:'2026-10-26T12:00:00Z',collector:'County collector',collectorAccount:parcel.accountId,version:'issued',total:100,authorities:[{name:'County + school collected together',levied:100}]};
const raw=(bills:any[])=>JSON.stringify([{year:2025,account:parcel.accountId,bills}]);
it('retains originals and explicit revised/supplemental bills without double-counting superseded charges',()=>{const r=importAssistedBills(raw([bill,{...bill,id:'revised-1',version:'revised',supersedes:'issued-1',total:90,authorities:[{name:'County + school collected together',levied:90}]},{...bill,id:'supplement-1',version:'supplemental',total:5,authorities:[{name:'County + school collected together',levied:5}]}]),parcel,originals);expect(r.records[0].facts.levied?.value).toBe(95);expect(r.sources[0].captureMethod).toBe('user_import');expect(r.records[0].facts.levied?.reviewed).toBe(false);expect(r.sources[0].evidence).toContain('issued-1');});
it('rejects missing originals, wrong accounts, unknown values, conflicting authorities and unreconciled totals',()=>{expect(()=>importAssistedBills(raw([bill]),parcel,[])).toThrow();expect(()=>importAssistedBills(raw([bill]),{...parcel,accountId:'wrong'},originals)).toThrow();expect(()=>importAssistedBills(raw([{...bill,total:99}]),parcel,originals)).toThrow();expect(()=>importAssistedBills(raw([bill,{...bill,id:'duplicate'}]),parcel,originals)).toThrow();expect(()=>importAssistedBills(raw([{...bill,authorities:[{name:'County',levied:null}]}]),parcel,originals)).toThrow();});
it.each([
 ['Bexar','542790','14101-005-0060','14101-005-0060'],
 ['Montgomery','R476340','92150000200','92150000200'],
 ['Travis','123456','02-3714-0806','02371408060000'],
 ['Dallas','380930000102R0000','lot-1','380930000102R0000'],
])('preserves and validates the printed collector account for %s assisted bills',(county,accountId,assessmentGroup,collectorAccount)=>{
 const p={...parcel,county,accountId,assessmentGroup};
 const manifest=JSON.stringify([{year:2025,account:accountId,bills:[{...bill,collectorAccount}]}]);
 const r=importAssistedBills(manifest,p,originals);
 expect(r.records[0].billEvidence?.collectorAccount).toBe(collectorAccount);
 expect(billAccountMatches(p,r.records[0])).toBe(true);
 expect(()=>importAssistedBills(manifest.replace(collectorAccount,'wrong'),p,originals)).toThrow();
});
