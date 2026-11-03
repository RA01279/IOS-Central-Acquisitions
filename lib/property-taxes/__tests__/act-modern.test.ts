import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseActRecord} from '../act';
import {researchModernAct,parseModernPaymentTable} from '../act-modern';
import {parcel as base,source} from './fixtures';
const parcel={...base,county:'MONTGOMERY',accountId:'476340.00000000',assessmentGroup:'9215-00-00200',address:'2511 N FRAZIER ST, CONROE, TX 77303'};
it('excludes the hidden no-payments template and keeps posted payments distinct from levies',()=>{const html=readFileSync('docs/tax-system-audit-20261026/montgomery/payment-info.jsp.html','utf8'),table=html.match(/<table[^>]*id="payment-history"[^>]*>([\s\S]*?)<\/table>/i)![1],totals=parseModernPaymentTable(table,2026);expect(totals.get(2025)).toBe(3844714);expect(totals.get(2024)).toBe(3884483);expect(totals.has(2026)).toBe(false);});
it('reads the independently checked Montgomery issued statement without treating scheduled-payment amounts as levy',()=>{const cells=JSON.parse(readFileSync('docs/tax-system-audit-20261026/montgomery/current-statements.pdf-1.json','utf8'));const r=parseActRecord(cells,parcel,source);expect([r.year,r.facts.levied?.value]).toEqual([2026,35370.15]);expect(r.jurisdictions).toHaveLength(5);});
it.runIf(process.env.LIVE_TAX==='1')('retrieves current Montgomery bills and payments separately',async()=>{const r=await researchModernAct(parcel);console.log(r.message);expect(r.records.find(r=>r.year===2026)?.facts.levied?.value).toBe(35370.15);expect(r.records.find(r=>r.year===2025)?.facts.paid?.value).toBe(38447.14);expect(r.records.find(r=>r.year===2025)?.facts.levied).toBeUndefined();},90000);
