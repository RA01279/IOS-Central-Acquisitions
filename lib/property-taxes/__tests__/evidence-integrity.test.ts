import {it,expect} from 'vitest';
import {taxFixture} from './fixtures';
import {annualTotal,mergeResearch,effectiveFact} from '../model';
import {historyCoverage} from '../coverage';
import {parseGwinnettBill} from '../gwinnett';
import {readFileSync} from 'node:fs';
it('duplicate account-year bills cannot yield a complete total or coverage',()=>{
 const state=taxFixture();state.sources[0].kind='official';
 state.records.push(structuredClone(state.records[0]));
 expect(annualTotal(state,2026,'levied').total).toBeNull();
 expect(historyCoverage(state).retrieved).toBe(0);
});
it('wrong collector account cannot satisfy history coverage',()=>{
 const state=taxFixture();state.sources[0].kind='official';
 state.records[0].billEvidence={kind:'collector_history',sourceId:state.sources[0].id,collectorAccount:'wrong',scope:'test',notes:'test'};
 expect(historyCoverage(state).retrieved).toBe(0);
 expect(annualTotal(state,2026,'levied').total).toBeNull();
});
it('new proposed figures cannot erase a saved issued bill on refresh',()=>{
 const saved=taxFixture(),incoming=taxFixture();incoming.records[0].facts.levied={...incoming.records[0].facts.levied!,value:999,stage:'proposed'};
 incoming.research={at:new Date().toISOString(),status:'partial',gaps:[]};
 const merged=mergeResearch(saved,incoming);
 expect(merged.records[0].facts.levied?.value).toBe(2000);
 expect(merged.research?.gaps.join(' ')).toContain('saved levy retained');
});
it('retains saved history and override through blocked refresh and JSON reload',()=>{
 const state=taxFixture();state.overrides=[{parcelKey:state.parcels[0].key,year:2026,metric:'levied',value:2100,sourceId:state.sources[0].id,reason:'Correction'}];
 const incoming=taxFixture();incoming.records=[];incoming.research={at:new Date().toISOString(),status:'partial',gaps:['Blocked'],attempts:[{parcelKey:state.parcels[0].key,status:'blocked',message:'Interactive access required'}]};
 const saved=JSON.parse(JSON.stringify(mergeResearch(state,incoming)));
 expect(saved.records[0].facts.levied.value).toBe(2000);
 expect(effectiveFact(saved,saved.records[0],'levied')?.value).toBe(2100);
 expect(saved.research.attempts[0].status).toBe('blocked');
});
it('rejects a wrong bill header even when the expected account appears elsewhere',()=>{
 const raw=readFileSync(new URL('./amwiler-bill.txt',import.meta.url),'utf8');
 const state=taxFixture();
 expect(()=>parseGwinnettBill(raw.replaceAll('R6250 010','R6250 023')+' R6250 010','R6250 010','3000 Amwiler Rd',state.sources[0],'subject')).toThrow();
});
