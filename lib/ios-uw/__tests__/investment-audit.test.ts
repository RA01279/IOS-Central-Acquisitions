import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {parseCompTable,isExplicitCompTable} from '../../comps/parse';
import {compRate} from '../../comps/market';
import {findDuplicate} from '../../comps/review';
import {sameStoredTransaction,conflictingEvidence} from '../../comps/conflicts';
import {parseReturnsSummary} from '../../excel-parser';
import {runUnderwriting} from '../engine';
import {runUnderwriting as runScreenUnderwriting} from '../../uw/engine';
import {rendon} from '../fixtures/rendon';

// Independent transcription: Conroe Comps (09.02.26), Lease Comps A2:R3.
const conroe='Address | Type | Rent Type | Building SF | Starting Rate (Monthly) | Term (Months) | Free Rent (Mo.) | Commencement Date | Tenant\n3626 N Frazier Industrial Park Dr | New | NNN | 9750 | 1.13 | 63 | 3 | 2026-01-01 | GroupSix Technologies';
describe('source-backed investment audit regressions',()=>{
 it('retains Conroe structure, deal kind and concessions without confusing Type and Rent Type',()=>{
  const r=parseCompTable(conroe).comps[0];expect(r).toMatchObject({rent:1.13,rentBasis:'per_sf_bldg_monthly',leaseType:'nnn',dealKind:'new',freeRentMonths:3,leaseTermMonths:63});
  const v=compRate({id:'conroe',comp_type:'lease',address:r.address,rent:r.rent,rent_basis:r.rentBasis,building_sf:9750,lease_term_months:63,free_rent_months:3},'industrial');
  expect(v?.face).toBeCloseTo(13.56,10);expect(v?.effective).toBeCloseTo(12.914285714285715,10);
 });
 it('uses direct extraction for a complete labeled table, preserving helper fallback for mixed or incomplete material',()=>{
  expect(isExplicitCompTable(conroe)).toBe(true);
  expect(isExplicitCompTable('Here is a lease report\n'+conroe)).toBe(false);
  expect(isExplicitCompTable(conroe+'\nAnother property is discussed below')).toBe(false);
 });
 it('does not invent a rent period from a bare PSF quote',()=>{
  const r=parseCompTable('Address | Tenant | Rent PSF | Commencement\n3626 N Frazier Industrial Park Dr | GroupSix | 13.56 | Jan 2026').comps[0];
  expect(r.rent).toBe(13.56);expect(r.rentBasis).toBeNull();expect(r.warnings.join(' ')).toMatch(/no supported monthly/);
 });
 it('retains the percent sign meaning for sub-1% and whole-percent escalations',()=>{
  const text='Address | Tenant | Starting Rate (Monthly) | Escalations | Commencement\n3626 N Frazier Industrial Park Dr | GroupSix | 1.13 | 0.30% | Jan 2026';
  expect(parseCompTable(text).comps[0].escalationsPct).toBe(.003);
  expect(parseCompTable(text.replace('0.30%','3.00%')).comps[0].escalationsPct).toBe(.03);
 });
 it('keeps separately identified Conroe buildings and repeat transactions distinct',()=>{
  const c={comp_type:'sale' as const,address:'3513 N Loop 336 W',project_name:'Pine Crossing Business Park - Bldg. C',closed_on:'2026-03-20',sale_price:860000,buyer:'Khattak Enterprises'};
  expect(860000/6000).toBeCloseTo(143.333333333333,10);
  expect(findDuplicate({...c,project_name:'Pine Crossing Business Park - Bldg. D'},[c])).toBeNull();
  expect(findDuplicate({...c,closed_on:'2024-03-20'},[c])).toBeNull();
  expect(sameStoredTransaction({...c,suite:'A'},{...c,suite:'B'})).toBe(false);
 });
 it('retains inline suites in the hidden Conroe evidence as separate transaction identifiers',()=>{
  const text='Address | Tenant | Starting Rate (Annual) | Commencement\n4910 Wright Rd., Suite 160 | Moziano Group | 9.48 | 2022-07-02\n4910 Wright Rd., Suite 120 | Moziano Group | 9.48 | 2022-07-02';
  const [a,b]=parseCompTable(text).comps;expect(a.suite).toBe('160');expect(b.suite).toBe('120');
  const cv=(r:typeof a)=>({comp_type:'lease' as const,address:r.address,suite:r.suite,date_commenced:r.dateCommenced,tenant_name:r.tenantName,rent:r.rent});
  expect(findDuplicate(cv(a),[cv(b)])).toBeNull();
 });
 it('surfaces new conflicting economics while retaining manual corrections and nonconflicting repeat evidence',()=>{
  const saved={rent:1.13,rent_basis:'per_sf_bldg_monthly',free_rent_months:3};
  expect(conflictingEvidence({rent:1.2},saved)).toEqual(['rent']);
  expect(conflictingEvidence({rent:'1.13',free_rent_months:3},saved)).toEqual([]);
  expect(conflictingEvidence({rent:null},saved)).toEqual([]);expect(saved.rent).toBe(1.13);
 });
 async function model(basis:string,property='1626 Central Park Dr'){
  // Pro Forma states the rate period in the column heading above "Market Rent"; a hidden Summary Table is never read.
  const wb=new ExcelJS.Workbook(),stale=wb.addWorksheet('Summary Table',{state:'hidden'}),p=wb.addWorksheet('Pro Forma');
  stale.getCell('G18').value=99;
  p.getCell('B16').value='Address';p.getCell('F16').value=property;p.getCell('B33').value='Purchase Price';p.getCell('F33').value=4000000;
  p.getCell('E153').value=basis;p.getCell('B162').value='Market Rent';p.getCell('E162').value=12.6;
  return Buffer.from(await wb.xlsx.writeBuffer());
 }
 it('reads the stated Pro Forma rent period instead of assuming monthly',async()=>{
  const r=await parseReturnsSummary(await model('$ PSF / Yr.'),'1626 Central Park Dr');
  expect(r.marketRentPsfMo).toBeCloseTo(1.05,10);expect(r.marketRentSourceBasis).toBe('Pro Forma Market Rent ($ PSF / Yr.)');
  expect((await parseReturnsSummary(await model('$ PSF / Mo.'))).marketRentPsfMo).toBe(12.6);
  expect((await parseReturnsSummary(await model('unknown'))).marketRentPsfMo).toBeNull();
 });
 it('retains the documented Amwiler/Lathrop discrepancy for explicit source review',async()=>{
  const conflicted=await parseReturnsSummary(await model('$ PSF / Yr.','1301-1347 Lathrop'),'3000 Amwiler Rd');
  expect(conflicted.warnings.join(' ')).toMatch(/Detected identity discrepancy/);
 });
 // Independently calculated from original Inputs/RentRoll/Capex, monthly
 // enumeration + amortization + bisection (scripts/reconcile-investment-cashflows.cjs).
 it.each([
  ['Base',427815,7211101.865518993,0.13893900698742245,2.2276526238567977],
  ['Upside',553369,11625230.70428377,0.27141907619750605,4.3691333669622905],
  ['Downside',287210,3985410.0141322976,-0.08279082108127361,0.5691586743465573],
 ] as const)('reconciles independent %s cash flows, exit and equity returns', (scenario,noi,exit,irr,multiple)=>{
  const r=runUnderwriting({...rendon,scenario});expect(r.returns.year1Noi).toBeCloseTo(noi,6);expect(r.returns.grossExitValue).toBeCloseTo(exit,6);
  expect(r.returns.loanBalanceAtExit).toBeCloseTo(2748693.1744961794,6);expect(r.returns.leveredIrr).toBeCloseTo(irr,10);expect(r.returns.leveredMultiple).toBeCloseTo(multiple,10);
  expect(r.cashFlow.leveredCF[7]).toBeCloseTo(r.cashFlow.noi[7]+r.cashFlow.capexInHold[7]+r.cashFlow.netSale[7]+r.cashFlow.debtService[7]-r.returns.loanBalanceAtExit,6);
  const screen=runScreenUnderwriting({...rendon,scenario});
  expect(screen.returns.year1Noi).toBeCloseTo(noi,6);
  expect(screen.returns.grossExitValue).toBeCloseTo(exit,6);
  expect(screen.returns.loanBalanceAtExit).toBeCloseTo(2748693.1744961794,6);
  expect(screen.returns.leveredIrr).toBeCloseTo(irr,10);
  expect(screen.returns.leveredMultiple).toBeCloseTo(multiple,10);
 });
});
