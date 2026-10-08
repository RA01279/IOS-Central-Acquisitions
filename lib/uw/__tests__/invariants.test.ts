// Invariants that must hold for any inputs, checked on the Rendon defaults
// and its scenarios.

import { describe, expect, it } from "vitest";
import { buildCashFlow, runUnderwriting } from "../engine";
import { irr, npv } from "../irr";
import { RENDON_CASES, rendon } from "../fixtures/rendon";
import type { UwInputs } from "../types";

const VARIANTS: Array<[string, UwInputs]> = [
  ["Base", rendon],
  ["Upside", { ...rendon, scenario: "Upside" }],
  ["Downside", { ...rendon, scenario: "Downside" }],
  ["Reassessed", { ...rendon, TaxSwitch: 1 }],
  ["Hold 1", { ...rendon, Hold: 1 }],
  ["Hold 10", { ...rendon, Hold: 10 }],
];

describe("IRR at the solved price equals the target unlevered IRR", () => {
  for (const [name, inputs] of VARIANTS) {
    it(name, () => {
      const { solvedPrice } = runUnderwriting(inputs).returns;
      // Reassessed taxes scale with price, so this also proves the closed form's tax term.
      const atSolved = runUnderwriting({ ...inputs, PurchPrice: solvedPrice }).returns;
      expect(atSolved.unleveredIrr).not.toBeNull();
      expect(atSolved.unleveredIrr!).toBeCloseTo(inputs.TgtUnlev, 10);
    });
  }
});

describe("IRR at the solved price equals the target in every Phase 1b case", () => {
  for (const name of ["LargeInBase", "Rate0", "Hold1", "CapexAfterExit"] as const) {
    it(name, () => {
      const inputs = RENDON_CASES[name];
      const { solvedPrice } = runUnderwriting(inputs).returns;
      const atSolved = runUnderwriting({ ...inputs, PurchPrice: solvedPrice }).returns;
      expect(atSolved.unleveredIrr).not.toBeNull();
      expect(atSolved.unleveredIrr!).toBeCloseTo(inputs.TgtUnlev, 10);
    });
  }
});

describe("the center of each sensitivity grid equals the headline IRR", () => {
  for (const [name, inputs] of VARIANTS) {
    it(name, () => {
      const { returns, sensitivity } = runUnderwriting(inputs);
      expect(sensitivity.unlevered[2][2]).toBe(returns.unleveredIrr);
      expect(sensitivity.levered[2][2]).toBe(returns.leveredIrr);
    });
  }
});

describe("tenant revenue sums to total revenue", () => {
  for (const [name, inputs] of VARIANTS) {
    it(name, () => {
      const cf = buildCashFlow(inputs);
      cf.totalRevenue.forEach((total, t) => {
        const byTenant = cf.tenantRevenue.reduce((s, row) => s + row[t], 0);
        expect(byTenant).toBeCloseTo(total, 9);
      });
    });
  }
});

describe("hold period edges", () => {
  for (const Hold of [1, 10]) {
    it(`Hold ${Hold} runs and produces finite results`, () => {
      const { returns, cashFlow } = runUnderwriting({ ...rendon, Hold });
      expect(cashFlow.exitFlag[Hold]).toBe(1);
      expect(cashFlow.exitFlag.reduce((a, b) => a + b, 0)).toBe(1);
      expect(Number.isFinite(returns.grossExitValue)).toBe(true);
      expect(returns.grossExitValue).toBeGreaterThan(0);
      expect(returns.unleveredIrr).not.toBeNull();
      expect(returns.leveredIrr).not.toBeNull();
      expect(Number.isFinite(returns.solvedPrice)).toBe(true);
    });
  }

  it("Hold 10 exits on year-11 forward NOI", () => {
    const { cashFlow } = runUnderwriting({ ...rendon, Hold: 10 });
    expect(cashFlow.grossExit[10]).toBeCloseTo(cashFlow.noi[11] / 0.07, 6);
  });

  it.each([0, 11, 5.5])("rejects Hold %s", (Hold) => {
    expect(() => runUnderwriting({ ...rendon, Hold })).toThrow(/Hold/);
  });
});

describe("leverage off", () => {
  for (const [name, inputs] of VARIANTS) {
    it(`${name}: levered equals unlevered`, () => {
      const { cashFlow, returns } = runUnderwriting({ ...inputs, LevOn: 0 });
      cashFlow.leveredCF.forEach((v, t) => expect(v).toBeCloseTo(cashFlow.unleveredCF[t], 9));
      expect(returns.leveredIrr).toBe(returns.unleveredIrr);
      expect(returns.leveredMultiple).toBe(returns.unleveredMultiple);
      expect(returns.minDscr).toBeNull();
      expect(returns.loanAmount).toBe(0);
    });
  }
});

describe("debt guards", () => {
  it("zero loan: no debt service, no payoff", () => {
    const cf = buildCashFlow({ ...rendon, LoanLTV: 0 });
    expect(cf.debtService.every((v) => v === 0)).toBe(true);
    expect(cf.loanPayoff.every((v) => v === 0)).toBe(true);
  });

  it("zero rate: no interest; principal straight-line after IO; balance repaid at exit", () => {
    const cf = buildCashFlow({ ...rendon, LoanRate: 0 });
    const loan = cf.loanProceeds[0];
    expect(cf.interest.every((v) => v === 0)).toBe(true);
    expect(cf.principal[rendon.IOYrs]).toBe(0);
    expect(cf.principal[rendon.IOYrs + 1]).toBeCloseTo(-loan / rendon.AmortYrs, 9);
    const repaidInHold = (rendon.Hold - rendon.IOYrs) * (loan / rendon.AmortYrs);
    expect(cf.loanPayoff[rendon.Hold]).toBeCloseTo(-(loan - repaidInHold), 9);
  });

  it.each([-0.01, -1e-9, Number.NaN])("rejects LoanRate %s", (LoanRate) => {
    expect(() => runUnderwriting({ ...rendon, LoanRate })).toThrow(/LoanRate/);
  });

  it("annual debt service equals 12 monthly payments once amortising", () => {
    const cf = buildCashFlow(rendon);
    const r = rendon.LoanRate / 12;
    const n = rendon.AmortYrs * 12;
    const loan = cf.loanProceeds[0];
    const pmt = (loan * r) / (1 - (1 + r) ** -n);
    expect(-cf.debtService[3]).toBeCloseTo(12 * pmt, 6);
    expect(-cf.debtService[1]).toBeCloseTo(loan * rendon.LoanRate, 9);
  });

  it("periods past amortisation pay nothing and leave a zero balance", () => {
    const cf = buildCashFlow({ ...rendon, AmortYrs: 5, IOYrs: 2 });
    expect(cf.debtService[8]).toBe(0);
    expect(cf.loanBalance[7]).toBeCloseTo(0, 6);
  });
});

describe("irr()", () => {
  it("returns null, never NaN, when no IRR exists", () => {
    expect(irr([100, 50, 25])).toBeNull();
    expect(irr([-100, -50])).toBeNull();
    expect(irr([0, 0, 0])).toBeNull();
  });

  it("finds a deeply negative IRR via the fallback guesses", () => {
    const cf = [-1000, 100, 100, 100];
    const r = irr(cf);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(-0.3);
    expect(npv(r!, cf)).toBeCloseTo(0, 6);
  });

  it("matches a known value", () => {
    expect(irr([-100, 110])!).toBeCloseTo(0.1, 12);
  });
});
