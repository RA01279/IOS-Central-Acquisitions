import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {historyCoverage} from '../coverage';import {taxFixture} from './fixtures';import {emptyTaxState} from '../types';
import {importGwinnettHistory} from '../gwinnett-history-import';import TaxResearchResult from '../../../components/property-taxes/TaxResearchResult';
const raw=readFileSync(new URL('./gwinnett-history-capture.txt',import.meta.url),'utf8');
const parcel={...taxFixture().parcels[0],accountId:'R6250 010',county:'Gwinnett',state:'GA',address:'3000 Amwiler Road'};
const url='https://www.gwinnetttaxcommissioner.com/property-tax/view-pay-your-taxes/-/p/propertyInfo/R6250+010/1085543';
it('imports the actual county bill history with billed amounts, payments and balances kept separate',()=>{
 const result=importGwinnettHistory(raw,url,parcel);
 expect(result.records.map(r=>[r.year,r.facts.levied?.value])).toEqual([[2026,7259.41],[2025,7079.41],[2024,7152.96],[2023,7171.35],[2022,7371.54]]);
 expect(result.records[1].facts.paid?.value).toBe(7079.41);expect(result.records[1].facts.balance?.value).toBe(0);expect(result.source.kind).toBe('manual');expect(result.source.captureMethod).toBe('user_import');
 const state=emptyTaxState();state.parcels=[parcel];state.sources=[result.source];state.records=result.records;state.research={at:new Date().toISOString(),status:'partial',gaps:[]};
 expect(historyCoverage(state).historyComplete).toBe(true);expect(historyCoverage(state).needsReview).toBe(true);
 expect(renderToStaticMarkup(createElement(TaxResearchResult,{state}))).toContain('5 of 5');
});
it('rejects wrong account/address/host, shifted columns and unreconciled amounts',()=>{
 for(const text of [raw.replace('R6250 010','R6250 023'),raw.replace('3000 AMWILER','3002 AMWILER'),raw.replace('$7,079.41\t$7,079.41','$7,000.00\t$7,079.41'),raw.replace('2025\t$7,079.41','2025\t\t$7,079.41')])expect(()=>importGwinnettHistory(text,url,parcel)).toThrow();
 expect(()=>importGwinnettHistory(raw,url.replace('www.gwinnetttaxcommissioner.com','example.test'),parcel)).toThrow();
});
it('requires five bills for every non-excluded account and never counts values, proposed taxes or stale-year labels',()=>{
 const state=taxFixture();state.sources[0].taxYear=2026;state.sources[0].kind='official';state.research={at:new Date().toISOString(),status:'partial',gaps:[]};
 expect(historyCoverage(state).retrieved).toBe(1);expect(historyCoverage(state).historyComplete).toBe(false);
 state.parcels.push({...state.parcels[0],key:'second',accountId:'second'});expect(historyCoverage(state).expected).toBe(10);
 state.parcels[1].review='excluded';expect(historyCoverage(state).expected).toBe(5);
 state.records[0].facts.levied!.stage='proposed';expect(historyCoverage(state).retrieved).toBe(0);
 state.records[0].facts.levied!.stage='issued';state.sources[0].taxYear=2025;expect(historyCoverage(state).retrieved).toBe(0);
 expect(renderToStaticMarkup(createElement(TaxResearchResult,{state}))).toContain('historical bills incomplete');
});
