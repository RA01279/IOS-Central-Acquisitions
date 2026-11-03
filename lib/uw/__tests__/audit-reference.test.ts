import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {runUnderwriting} from "../engine";
import {engineInputs} from "../deal-inputs";
const reference=JSON.parse(readFileSync(new URL("../fixtures/kennedale-audit.json",import.meta.url),"utf8"));
it("reproduces independent Kennedale monthly base and six-month delay including carrying costs",()=>{
 const results=reference.cases.map((c:any)=>{
  const r=runUnderwriting(c.inputs);expect(r.returns.leveredIrr).toBeCloseTo(c.independent.leveredIrr,8);expect(r.returns.year1Noi).toBeCloseTo(c.independent.noi[0],2);expect(r.returns.solvedPrice).toBeCloseTo(c.independent.solvedPrice,2);return r;
 });
 expect(results[2].returns.year1Noi).toBeLessThan(results[0].returns.year1Noi);expect(results[2].returns.minDscr).toBeCloseTo(.4902506456,6);
});
it("retains independently calculated carrying expenses before explicit full recovery and solves price consistently",()=>{
 const base=reference.cases[2].inputs;
 const atClosing=runUnderwriting(engineInputs({...base,NnnRecovered:true,RecoveryStartMonth:0}));
 const delayed=runUnderwriting(engineInputs({...base,NnnRecovered:true,RecoveryStartMonth:6}));
 expect(delayed.cashFlow.propertyTax[1]).toBeCloseTo(-82500,2);expect(delayed.cashFlow.insurance[1]).toBeCloseTo(-1087.5,2);expect(delayed.cashFlow.propertyTax[2]).toBeCloseTo(0,2);
 expect(delayed.returns.year1Noi).toBeCloseTo(atClosing.returns.year1Noi-83587.5,2);expect(delayed.returns.leveredIrr!).toBeLessThan(atClosing.returns.leveredIrr!);
 const solved=runUnderwriting(engineInputs({...base,NnnRecovered:true,RecoveryStartMonth:6,PurchPrice:delayed.returns.solvedPrice}));
 const npv=solved.cashFlow.unleveredCF.reduce((total:number,cf:number,year:number)=>total+cf/(1+base.TgtUnlev)**year,0);expect(npv).toBeCloseTo(0,1);
});
