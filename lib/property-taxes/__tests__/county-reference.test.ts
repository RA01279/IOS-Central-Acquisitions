import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {importGwinnettHistory} from '../gwinnett-history-import';
import {parcel} from './fixtures';
const dir=new URL('../../../docs/tax-evidence-20261023/',import.meta.url);
const reference=JSON.parse(readFileSync(new URL('county-reference.json',dir),'utf8'));
it('matches freshly captured county history to independent levy/payment/balance references to the cent',()=>{
 const raw=readFileSync(new URL('amwiler-account.txt',dir),'utf8');
 const result=importGwinnettHistory(raw,'https://www.gwinnetttaxcommissioner.com/property-tax/view-pay-your-taxes/-/p/propertyInfo/R6250+010/1085543',{...parcel,accountId:'R6250 010',county:'Gwinnett',state:'GA',address:'3000 Amwiler Rd'});
 expect(result.records.map(r=>[r.year,r.facts.levied?.value,r.facts.paid?.value,r.facts.balance?.value])).toEqual(reference.amwiler.rows.map((r:any)=>[r.year,r.levy,r.paid,r.balance]));
 for(const row of reference.amwiler.rows){
  expect(Math.round((row.school+row.county+row.stormwater+row.commercialService)*100)).toBe(Math.round(row.levy*100));
  if(row.receipts)expect(row.receipts.reduce((s:number,v:number)=>s+Math.round(v*100),0)).toBe(Math.round(row.paid*100));
 }
});
