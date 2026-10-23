import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';
import {parseHarrisHistory,researchHarrisHistory} from '../harris';import {source,parcel} from './fixtures';
import {researchTaxes} from '../research';import {emptyTaxState} from '../types';import {validateTaxState} from '../store';
const html=readFileSync(new URL('./harris-history.html',import.meta.url),'utf8'),statement=readFileSync(new URL('./harris-statement.html',import.meta.url),'utf8');
const subject={...parcel,key:'tx:harris:0612170060008',accountId:'0612170060008',address:'1626 Central Park Drive',county:'Harris'};
it('integrates dated collector bills with parcel research and validates the saved workspace shape',async()=>{
 const fetcher=async(input:any)=>{const url=String(input);
  if(url.includes('census.gov'))return Response.json({result:{geographies:{Counties:[{NAME:'Harris County'}],States:[{STUSAB:'TX'}]}}});
  if(url.includes('/identify'))return Response.json({results:[{attributes:{PROP_ID:subject.accountId,COUNTY:'HARRIS',SITUS_ADDR:subject.address,GEO_ID:subject.accountId,MKT_VALUE:2990499,TAX_YEAR:2026}}]});
  if(url.includes('ViewStatementReceipts'))return new Response('Public search',{headers:{'Set-Cookie':'SESSION=synthetic; HttpOnly'}});
  if(url.includes('AccountEncrypt'))return new Response('synthetic-public-account-token');
  if(url.includes('TaxStatement'))return new Response(statement);
  if(url.includes('HistoryTab'))return new Response(html);
  return new Response('Official valuation and rate rules');
 };
 const report=await researchTaxes({address:subject.address,state:'TX',latitude:29.9605349,longitude:-95.3751835,precision:'manual'},emptyTaxState(),()=>{},fetcher as any);
 expect(report.records.filter(r=>r.billEvidence)).toHaveLength(5);expect(report.records.find(r=>r.year===2025)?.facts.levied?.value).toBe(27462.14);expect(()=>validateTaxState(report)).not.toThrow();
 expect(JSON.stringify(report.sources)).not.toContain('SESSION=synthetic');
});
it('imports official historical bill amounts, including paid years, rather than current balances',()=>{
 const rows=parseHarrisHistory(html,statement,subject,source);
 expect(rows.map(r=>[r.year,r.facts.levied?.value])).toEqual([[2025,27462.14],[2024,26947.83],[2023,25333.8],[2022,3450.45],[2021,2505.29]]);
 expect(rows.every(r=>r.facts.paid===undefined&&r.facts.balance===undefined)).toBe(true);
 expect(rows[0].jurisdictions).toHaveLength(8);expect(rows[0].billEvidence?.scope).toContain('separately billed');expect(rows[0].facts.levied?.reviewed).toBe(false);
});
it('rejects wrong accounts, incorrect situs identity and non-reconciling totals',()=>{
 expect(()=>parseHarrisHistory(html,statement,{...subject,accountId:'0612170060009'},source)).toThrow('account');
 expect(()=>parseHarrisHistory(html,statement,{...subject,address:'1628 Central Park Dr'},source)).toThrow('situs');
 expect(()=>parseHarrisHistory(html.replace('$27,462.14','$27,000.00'),statement,subject,source)).toThrow('reconcile');
});
it('keeps unavailable historical totals missing instead of manufacturing zero bills',()=>{
 const rows=parseHarrisHistory(html.replace('$2,505.29',''),statement,subject,source);
 expect(rows.some(r=>r.year===2021)).toBe(false);expect(rows).toHaveLength(5); // includes older published 2020 as the fifth available year
 expect(rows.at(-1)?.year).toBe(2020);
});
it.runIf(process.env.VERIFY_HARRIS_HISTORY==='1')('retrieves real official history without writing production',async()=>{
 const r=await researchHarrisHistory(subject);expect(r.records).toHaveLength(5);expect(r.records[0].year).toBeGreaterThanOrEqual(2025);expect(r.records[0].facts.levied?.value).toBeGreaterThan(0);
},60000);
it('retries retained subject accounts even when the current GIS lookup fails, and skips excluded neighbors',async()=>{
 const state=emptyTaxState();state.sources=[source];state.parcels=[{...subject,review:'included',identityOverride:true},{...subject,key:'excluded',accountId:'0612170060009',review:'excluded'}];
 const calls:string[]=[];
 const fetcher=async(input:any)=>{const url=String(input);calls.push(url);
  if(url.includes('census.gov')||url.includes('/identify'))return new Response('Unavailable',{status:503});
  if(url.includes('ViewStatementReceipts'))return new Response('Public search');
  if(url.includes('AccountEncrypt'))return new Response('synthetic-public-account-token');
  if(url.includes('TaxStatement'))return new Response(statement);
  if(url.includes('HistoryTab'))return new Response(html);
  return new Response('Official rules');
 };
 const report=await researchTaxes({address:subject.address,state:'TX',latitude:29.96,longitude:-95.37,precision:'manual'},state,()=>{},fetcher as any);
 expect(report.records.filter(r=>r.billEvidence)).toHaveLength(5);
 expect(report.research?.attempts).toHaveLength(1);expect(report.research?.attempts?.[0].status).toBe('retrieved');
 expect(calls.some(u=>u.includes('0612170060009'))).toBe(false);
});
