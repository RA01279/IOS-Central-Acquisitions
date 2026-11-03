import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {parseActRecord,actAccount,researchActHistory} from '../act';
import {parcel as base,source as original} from './fixtures';
// The retained county originals (docs/tax-system-audit-20261026) hold portfolio tax records and stay out of git
// (the repository is public); these checks run where that folder exists and skip in CI.
const audit=existsSync('docs/tax-system-audit-20261026'),itAudit=it.skipIf(!audit);
const parcel={...base,key:'tx:dallas:26095600010010000',county:'DALLAS',accountId:'26095600010010000',address:'515 Mills Road'};
const source={...original,kind:'official' as const};
const cells=(audit?JSON.parse(readFileSync('docs/tax-system-audit-20261026/dallas/receipt-2025.pdf-1.json','utf8')):null);
const current=(audit?JSON.parse(readFileSync('docs/tax-system-audit-20261026/dallas/current.pdf-1.json','utf8')):null);
const bexar={...parcel,key:'tx:bexar:542790',county:'BEXAR',accountId:'542790',assessmentGroup:'14101-005-0060',address:'4711 BROOM ST SAN ANTONIO, TX 78217'};
const bexarCells=(audit?JSON.parse(readFileSync('docs/tax-system-audit-20261026/bexar/receipt-2025.pdf-1.json','utf8')):null);
const bexarCurrent=(audit?JSON.parse(readFileSync('docs/tax-system-audit-20261026/bexar/current.pdf-1.json','utf8')):null);
itAudit('reuses ACT levy extraction with the verified Bexar geographic-account alias and statement extension',()=>{expect(parseActRecord(bexarCells,bexar,source,2025).facts.levied?.value).toBe(36891.35);expect(parseActRecord(bexarCurrent,bexar,source).facts.levied?.value).toBe(34582.07);});
// Expected amounts independently transcribed from rendered original county PDFs.
itAudit('Mills Dallas yearly Levy is 13964.73, independently of payment/refund/remaining balance columns',()=>{
 const row=parseActRecord(cells,parcel,source,2025);expect(row.facts.levied?.value).toBe(13964.73);expect(row.facts.paid).toBeUndefined();expect(row.jurisdictions.map(j=>j.name)).toEqual(['DALLAS COUNTY','PARKLAND HOSPITAL','DALLAS COLLEGE']);expect(row.billEvidence?.obligationStatus).toBe('partial');
});
itAudit('Mills current issued statement is 14831.68 for the printed 2026 tax year',()=>{const row=parseActRecord(current,parcel,source);expect([row.year,row.facts.levied?.value]).toEqual([2026,14831.68]);});
itAudit('fails closed on wrong account, situs, year, missing levy, ambiguous columns and changed totals',()=>{
 expect(()=>parseActRecord(cells,{...parcel,accountId:'26095600010020000'},source,2025)).toThrow();
 expect(()=>parseActRecord(cells,{...parcel,address:'517 Mills Road'},source,2025)).toThrow();
 expect(()=>parseActRecord(cells,parcel,source,2024)).toThrow();
 expect(()=>parseActRecord(cells.filter((c:any)=>c.text!=='Levy Total :'),parcel,source,2025)).toThrow();
 expect(()=>parseActRecord(cells.map((c:any)=>c.text==='5,634.79'?{...c,text:'5,000.00'}:c),parcel,source,2025)).toThrow();
 expect(()=>actAccount({...parcel,accountId:'2609560001001000'})).toThrow();
});
it.runIf(process.env.LIVE_TAX==='1')('retrieves Mills through the normal public account workflow',async()=>{const r=await researchActHistory(parcel);expect(r.gaps).toEqual([]);expect(r.records.map(r=>r.year)).toEqual([2026,2025,2024,2023,2022]);expect(r.records.find(r=>r.year===2025)?.facts.levied?.value).toBe(13964.73);},90000);
it.runIf(process.env.LIVE_TAX==='1')('retrieves Bexar through its county configuration',async()=>{const r=await researchActHistory(bexar);expect(r.gaps).toEqual([]);expect(r.records.map(r=>r.year)).toEqual([2026,2025,2024,2023,2022]);expect(r.records.find(r=>r.year===2025)?.facts.levied?.value).toBe(36891.35);},90000);
