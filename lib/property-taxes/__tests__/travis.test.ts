import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';
import {parseTravisHistory,researchTravisHistory,travisCollectorAccount} from '../travis';import {source,parcel} from './fixtures';
const cells=JSON.parse(readFileSync(new URL('./travis-positions.json',import.meta.url),'utf8'));
const first=readFileSync(new URL('./travis-bill.txt',import.meta.url),'utf8').split('PAGE 2')[0];
const subject={...parcel,key:'tx:travis:240449',accountId:'240449',address:'8319 N Lamar Blvd',county:'Travis',assessmentGroup:'0237140806'};
it('reads the correct year/column totals from the official five-year bill table',()=>{
 expect(travisCollectorAccount(subject)).toBe('02371408060000');
 const records=parseTravisHistory(cells,first,subject,source);
 expect(records.map(r=>[r.year,r.facts.levied?.value])).toEqual([[2025,157106.14],[2024,152141.43],[2023,153718.49],[2022,157993.84],[2021,156720.89]]);
 expect(records.every(r=>r.facts.paid===undefined&&r.facts.balance===undefined)).toBe(true);
 expect(records[0].billEvidence?.collectorAccount).toBe('02371408060000');
});
it('rejects wrong subject identity, unrecognized layouts and non-reconciling bill amounts',()=>{
 expect(()=>parseTravisHistory(cells,first,{...subject,address:'8317 N Lamar Blvd'},source)).toThrow('situs');
 expect(()=>parseTravisHistory(cells,first,{...subject,assessmentGroup:'0237140807'},source)).toThrow('account');
 expect(()=>parseTravisHistory(cells.filter((c:any)=>c.text!=='Five Year Tax History'),first,subject,source)).toThrow('layout');
 expect(()=>parseTravisHistory(cells.map((c:any)=>c.text==='157,106.14'?{...c,text:'157,000.00'}:c),first,subject,source)).toThrow('reconcile');
});
it.runIf(process.env.VERIFY_TRAVIS_HISTORY==='1')('retrieves an official original bill and historical amounts without production writes',async()=>{
 const r=await researchTravisHistory(subject);expect(r.records).toHaveLength(5);expect(r.records[0].year).toBeGreaterThanOrEqual(2025);expect(r.source.url).toContain('travis.go2gov.net/export');
},60000);
