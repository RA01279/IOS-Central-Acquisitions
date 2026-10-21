import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGwinnettBill} from '../gwinnett';
const raw=readFileSync(new URL('./amwiler-bill.txt',import.meta.url),'utf8');
const source=()=>({id:'official',label:'Official 2026 Amwiler bill retrieved October 21 2026',url:'https://www.gwinnetttaxcommissioner.com/PropTaxBill/R6250%20010.pdf',retrievedAt:'2026-10-21',taxYear:null,kind:'official' as const,evidence:raw});
it('verifies the dated official temporary bill, including assessments and appeal without asserting payment status',()=>{
 const s=source(),r=parseGwinnettBill(raw,'R6250 010','3000 Amwiler Road',s,'subject');
 expect(r.year).toBe(2026);expect(s.taxYear).toBe(2026);
 expect(r.facts.levied?.value).toBe(7259.41);expect(r.facts.market?.value).toBe(459700);expect(r.facts.assessed?.value).toBe(183880);
 expect(r.facts.dueDate?.value).toBe('2026-11-15');expect(r.facts.appeal?.value).toContain('temporary');
 expect(r.facts.paid).toBeUndefined();expect(r.facts.balance).toBeUndefined();expect(r.jurisdictions[0].unit).toBe('decimal');expect(r.jurisdictions[0].rate).toBe(.0345);
});
it('rejects a neighbor, wrong account and non-reconciling bill',()=>{
 expect(()=>parseGwinnettBill(raw,'R6250 023','2999 Amwiler Rd',source(),'x')).toThrow();
 expect(()=>parseGwinnettBill(raw,'R6250 010','2999 Amwiler Rd',source(),'x')).toThrow();
 expect(()=>parseGwinnettBill(raw.replace('915.54','900.00'),'R6250 010','3000 Amwiler Rd',source(),'x')).toThrow();
});
