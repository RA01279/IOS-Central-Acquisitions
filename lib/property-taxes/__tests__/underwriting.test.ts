import {it,expect} from "vitest";
import {applyTaxSchedule} from "../underwriting";
import {rendon} from "../../ios-uw/fixtures/rendon";
import {runUnderwriting} from "../../ios-uw/engine";
import {buildUwView} from "../../ios-uw/view-model";
const schedule={scenario:"Synthetic annual case",startYear:2027,gross:Array.from({length:rendon.Hold+1},(_,i)=>30000+i*1000),reimbursements:Array.from({length:rendon.Hold+1},()=>5000),provenance:"Synthetic rules reviewed",appliedAt:"2026-10-21T00:00:00Z"};
it("replaces taxes once, removes embedded costs once, and credits recoveries outside rent",()=>{
  const original={...rendon,OtherOpex:10000},before=runUnderwriting(original),next=applyTaxSchedule(original,schedule,2000,true),after=runUnderwriting(next);
  expect(original.TaxSchedule).toBeUndefined();expect(original.OtherOpex).toBe(10000);expect(next.OtherOpex).toBe(8000);
  expect(after.cashFlow.propertyTax[1]).toBe(-30000);expect(after.cashFlow.propertyTaxRecovery[1]).toBe(5000);
  expect(after.cashFlow.totalRevenue).toEqual(before.cashFlow.totalRevenue);
  expect(after.returns.year1Noi-before.returns.year1Noi).toBeCloseTo(-before.cashFlow.propertyTax[1]-25000+2000,7);
  expect(buildUwView(next).cashFlow.find(r=>r.label==="Property tax reimbursements")?.values[1]).toBe(5000);
});
it("uses the forward schedule tax in exit NOI and keeps price solving consistent",()=>{
  const next=applyTaxSchedule(rendon,schedule,0,true),result=runUnderwriting(next);
  expect(result.cashFlow.propertyTax[rendon.Hold+1]).toBe(-schedule.gross[rendon.Hold]);
  expect(result.cashFlow.reassessedTaxPerDollar.every(n=>n===0)).toBe(true);
  const solved=runUnderwriting({...next,PurchPrice:result.returns.solvedPrice});expect(solved.returns.unleveredIrr).toBeCloseTo(next.TgtUnlev,9);
  expect(runUnderwriting({...next,PurchPrice:next.PurchPrice*2}).cashFlow.propertyTax).toEqual(result.cashFlow.propertyTax);
});
it("blocks unchecked treatment, duplicate embedded expense corrections and hold mismatches",()=>{
  expect(()=>applyTaxSchedule(rendon,schedule,0,false)).toThrow(/Review/);
  expect(()=>applyTaxSchedule({...rendon,OtherOpex:0},schedule,10,true)).toThrow(/OtherOpex/);
  expect(()=>applyTaxSchedule({...rendon,Hold:1},schedule,0,true)).toThrow(/hold/);
  expect(()=>runUnderwriting({...rendon,TaxSchedule:{...schedule,gross:[-1]}})).toThrow(/schedule/);
});
