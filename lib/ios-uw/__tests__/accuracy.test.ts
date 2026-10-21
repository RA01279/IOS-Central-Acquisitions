import { describe, expect, it } from "vitest";
import { runUnderwriting } from "../engine";
import { irr, npv } from "../irr";
import { rendon } from "../fixtures/rendon";

describe("underwriting accuracy guards", () => {
  it.each([
    ["PurchPrice", 0], ["PurchPrice", Infinity], ["Acres", 0], ["Insurance", NaN],
    ["LoanLTV", 1.1], ["SaleCost", -0.01], ["TaxRate", Infinity], ["MgmtPct", -0.1],
    ["StepCap", -0.01], ["TgtUnlev", -1], ["ReservePerAcre", -1],
  ])("rejects invalid %s = %s before displaying returns", (key, value) => {
    expect(() => runUnderwriting({ ...rendon, [key]: value })).toThrow(String(key));
  });
  it("rejects invalid tenant and capex inputs instead of producing believable returns", () => {
    expect(() => runUnderwriting({ ...rendon, rentRoll: [{ ...rendon.rentRoll[0], rent: NaN }] })).toThrow(/rent/);
    expect(() => runUnderwriting({ ...rendon, capex: [{ ...rendon.capex[0], year: 0 }] })).toThrow(/year/);
    expect(() => runUnderwriting({ ...rendon, levers: { ...rendon.levers, Vacancy: [1.1, 0, 0] } })).toThrow(/Vacancy/);
  });
  it("marks nonpositive sensitivity caps unavailable while keeping the valid headline case", () => {
    const result = runUnderwriting({ ...rendon, StepCap: 0.04 });
    expect(result.sensitivity.unlevered[2][0]).toBeNull();
    expect(result.sensitivity.unlevered[2][2]).toBeCloseTo(result.returns.unleveredIrr!, 10);
  });
  it.each([1e-12, 1, 1e12])("IRR is invariant to cash flow scale %s and clears NPV", scale => {
    const flows = [-100, 5, 5, 115].map(v => v * scale);
    const rate = irr(flows)!;
    expect(rate).toBeCloseTo(irr([-100, 5, 5, 115])!, 11);
    expect(Math.abs(npv(rate, flows) / scale)).toBeLessThan(1e-8);
  });
  it("does not report an IRR from nonfinite cash flows", () => {
    expect(irr([-100, Infinity])).toBeNull();
    expect(irr([-100, 110, NaN])).toBeNull();
  });
  it("amortizes near-zero interest debt without numerical cancellation", () => {
    const result = runUnderwriting({ ...rendon, LoanRate: 1e-15, IOYrs: 0 });
    const expected = rendon.PurchPrice * rendon.LoanLTV / rendon.AmortYrs;
    expect(-result.cashFlow.principal[1]).toBeCloseTo(expected, 6);
    expect(result.cashFlow.interest[1]).toBeCloseTo(0, 6);
  });
});
