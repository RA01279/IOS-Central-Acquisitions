// Phase 3e: rollover method 2 -- renewal probability, renewal vs new-deal
// rent, downtime, free rent, TI and leasing commissions.

import { describe, expect, it } from "vitest";
import { annualRent, buildCashFlow, runUnderwriting } from "../engine";
import { RENDON_CASES, rendon } from "../fixtures/rendon";

const pct4 = (v: number | null) => (v === null ? null : Number((v * 100).toFixed(4)));
const YEARS = [1, 2, 3, 4, 5, 6, 7];

const GOLDEN = [
  {
    name: "RM2Default", unlev: 11.524, lev: 15.6212, noi1: 427_815, solved: 5_962_793, grossExit: 7_741_880, dscr: 1.839, yoc: 7.907,
    revenue: [457_700, 485_336, 493_212, 514_893, 530_340, 532_686, 562_637],
    leasing: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    name: "RM2SA", unlev: 11.7552, lev: 16.0096, noi1: 427_815, solved: 6_036_893, grossExit: 7_902_115, dscr: 1.839, yoc: 7.907,
    revenue: [457_700, 485_336, 493_212, 514_893, 530_340, 542_250, 574_100],
    leasing: [0, 0, 0, 0, 0, -28_500, 0],
  },
  {
    name: "RM2UpsideOverride", unlev: 21.4463, lev: 31.1652, noi1: 553_369, solved: 9_902_871, grossExit: 13_633_578, dscr: 2.71, yoc: 11.5895,
    revenue: [577_700, 717_288, 754_648, 794_990, 825_085, 847_290, 888_777],
    leasing: [0, -12_000, 0, 0, 0, 0, 0],
  },
] as const;

describe("rollover method 2 golden cases", () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const { returns: r, cashFlow: cf } = runUnderwriting(RENDON_CASES[g.name]);
      expect(pct4(r.unleveredIrr), "unlevered IRR").toBe(g.unlev);
      expect(pct4(r.leveredIrr), "levered IRR").toBe(g.lev);
      expect(Math.round(r.year1Noi), "Yr-1 NOI").toBe(g.noi1);
      expect(Math.round(r.solvedPrice), "solved price").toBe(g.solved);
      expect(Math.round(r.grossExitValue), "gross exit").toBe(g.grossExit);
      expect(Number(r.minDscr!.toFixed(3)), "min DSCR").toBe(g.dscr);
      expect(pct4(r.yieldOnCost), "yield on cost").toBe(g.yoc);
      expect(YEARS.map((t) => Math.round(cf.totalRevenue[t])), "total scenario revenue yrs 1-7").toEqual(g.revenue);
      expect(YEARS.map((t) => Math.round(cf.leasingCosts[t]) || 0), "leasing costs yrs 1-7").toEqual(g.leasing);
    });

    it(`${g.name}: solved price returns the target IRR`, () => {
      const inputs = RENDON_CASES[g.name];
      const { solvedPrice } = runUnderwriting(inputs).returns;
      expect(runUnderwriting({ ...inputs, PurchPrice: solvedPrice }).returns.unleveredIrr!).toBeCloseTo(inputs.TgtUnlev, 10);
    });

    it(`${g.name}: sensitivity center equals the headline IRR`, () => {
      const { returns, sensitivity } = runUnderwriting(RENDON_CASES[g.name]);
      expect(sensitivity.unlevered[2][2]).toBe(returns.unleveredIrr);
      expect(sensitivity.levered[2][2]).toBe(returns.leveredIrr);
    });
  }
});

describe("rollover mechanics", () => {
  it("downtime is one-time: Reindeer's year-4 revenue under method 2 is 10 points of rent above method 1", () => {
    // Method 1 keeps 90% retention forever; method 2 with p = 70% and equal
    // rents is back to 100% once the 3-month downtime (year 3) has passed.
    const reindeer = 1;
    const m1 = buildCashFlow(rendon).tenantRevenue[reindeer][4];
    const m2 = buildCashFlow(RENDON_CASES.RM2Default).tenantRevenue[reindeer][4];
    const fullYear4 = annualRent(rendon.rentRoll[reindeer]) * 1.03 ** 3;
    expect(m1).toBeCloseTo(0.9 * fullYear4, 6);
    expect(m2).toBeCloseTo(fullYear4, 6);
    expect(m2 - m1).toBeCloseTo(0.1 * fullYear4, 6);
    // Year 3 carries the downtime: (1 - p) x 3 months lost.
    const m2y3 = buildCashFlow(RENDON_CASES.RM2Default).tenantRevenue[reindeer][3];
    expect(m2y3).toBeCloseTo(annualRent(rendon.rentRoll[reindeer]) * 1.03 ** 2 * (12 - 0.3 * 3) / 12, 6);
  });

  it("method 1 is the default and ignores every rollover field", () => {
    const loaded = {
      ...rendon,
      rentRoll: rendon.rentRoll.map((t) => ({ ...t, renewalRent: 99_999, newDealRent: 1, newDealDowntimeMonths: 12, renewalTI: 1e6, newDealLC: 1e6 })),
    };
    const base = runUnderwriting({ ...rendon, RollMethod: undefined });
    const ignored = runUnderwriting(loaded);
    expect(ignored.returns).toEqual(base.returns);
    expect(buildCashFlow(loaded).leasingCosts.every((v) => v === 0)).toBe(true);
  });

  it("leasing costs are booked in INT(leaseEnd/12)+1, weighted by p and include %, not grown, and only in hold", () => {
    const cf = buildCashFlow(RENDON_CASES.RM2SA);
    // S&A ends month 60 -> year 6: 0.7 x 15,000 + 0.3 x 60,000.
    expect(cf.leasingCosts[6]).toBeCloseTo(-28_500, 9);
    expect(cf.capexInHold[6]).toBeCloseTo(-28_500, 9);
    // Same costs with a 5-year hold: still on row 37, but outside the hold.
    const short = buildCashFlow({ ...RENDON_CASES.RM2SA, Hold: 5 });
    expect(short.leasingCosts[6]).toBeCloseTo(-28_500, 9);
    expect(short.capexInHold[6]).toBeCloseTo(0, 9);
    // Excluded tenant: no cost.
    const excluded = buildCashFlow({
      ...RENDON_CASES.RM2SA,
      rentRoll: RENDON_CASES.RM2SA.rentRoll.map((t, i) => (i === 0 ? { ...t, include: [0, 1, 1] as const } : t)),
    });
    expect(excluded.leasingCosts[6]).toBeCloseTo(0, 9);
  });

  it("yield on cost still uses capex only, not leasing costs", () => {
    const withCosts = runUnderwriting({
      ...RENDON_CASES.RM2Default,
      rentRoll: rendon.rentRoll.map((t, i) => (i === 1 ? { ...t, renewalTI: 500_000 } : t)),
    }).returns;
    expect(withCosts.yieldOnCost).toBe(runUnderwriting(RENDON_CASES.RM2Default).returns.yieldOnCost);
  });

  it("tenants with no lease end have no rollover", () => {
    const cf = buildCashFlow({
      ...RENDON_CASES.RM2Default,
      rentRoll: rendon.rentRoll.map((t, i) => (i === 2 ? { ...t, newDealTI: 50_000, newDealDowntimeMonths: 12 } : t)),
    });
    expect(cf.leasingCosts.every((v) => v === 0)).toBe(true);
    expect(cf.tenantRevenue[2]).toEqual(buildCashFlow(RENDON_CASES.RM2Default).tenantRevenue[2]);
  });

  it("validates RollMethod, probabilities and month fields", () => {
    expect(() => runUnderwriting({ ...rendon, RollMethod: 3 as never })).toThrow(/RollMethod/);
    expect(() => runUnderwriting({ ...rendon, levers: { ...rendon.levers, RenewProb: [0.7, 1.2, 0.5] } })).toThrow(/RenewProb/);
    const tenantEdit = (edit: object) => ({ ...rendon, rentRoll: rendon.rentRoll.map((t, i) => (i === 1 ? { ...t, ...edit } : t)) });
    expect(() => runUnderwriting(tenantEdit({ renewalProbOverride: -0.1 }))).toThrow(/renewalProbOverride/);
    expect(() => runUnderwriting(tenantEdit({ newDealDowntimeMonths: 2.5 }))).toThrow(/newDealDowntimeMonths/);
    expect(() => runUnderwriting(tenantEdit({ newDealFreeRentMonths: 61 }))).toThrow(/newDealFreeRentMonths/);
    expect(() => runUnderwriting(tenantEdit({ renewalProbOverride: 0, newDealDowntimeMonths: 60 }))).not.toThrow();
  });
});
