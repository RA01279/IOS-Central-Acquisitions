// Phase 3d: free rent at the start of a lease and on renewal.

import { describe, expect, it } from "vitest";
import { buildCashFlow, runUnderwriting, tenantRevenue } from "../engine";
import { RENDON_CASES, rendon } from "../fixtures/rendon";
import type { Tenant } from "../types";

const pct4 = (v: number | null) => (v === null ? null : Number((v * 100).toFixed(4)));

const GOLDEN = [
  { name: "FreeNew", unlev: 16.2824, lev: 23.4371, noi1: 484_815, solved: 7_630_824, grossExit: 10_015_214, dscr: 2.374, yoc: 10.9989, revenue: [517_700, 695_456, 669_216, 689_292] },
  { name: "FreeRenew", unlev: 10.4976, lev: 13.8305, noi1: 427_815, solved: 5_646_935, grossExit: 7_211_102, dscr: 1.78, yoc: 7.907, revenue: [457_700, 485_336, 477_617, 505_714] },
  { name: "FreeBoth", unlev: 16.1604, lev: 23.1937, noi1: 478_165, solved: 7_593_160, grossExit: 10_015_214, dscr: 2.342, yoc: 10.5378, revenue: [510_700, 666_616, 655_848, 689_292] },
] as const;

describe("free rent golden cases", () => {
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
      expect([1, 2, 3, 4].map((t) => Math.round(cf.totalRevenue[t])), "revenue yrs 1-4 (row 19)").toEqual(g.revenue);
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

const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  name: "T", status: "In-place", acres: 1, rent: 1_000, rentPeriod: "Monthly", bump: 0.03,
  startMonth: 0, leaseEndMonth: 36, retention: 0.5, include: [1, 1, 1], ...over,
});
const ctx = { scenario: "Base" as const, RentGrowth: 0.03, LeaseDelay: 0 };
const rev = (t: Tenant, year: number) => tenantRevenue(t, year, ctx);

describe("free rent mechanics", () => {
  it("free rent longer than the lease term loses only the in-lease months", () => {
    const t = tenant({ leaseEndMonth: 12, freeRentMonths: 24 });
    const none = tenant({ leaseEndMonth: 12 });
    expect(rev(t, 1)).toBe(0);
    // Retained (post-lease) months are untouched.
    for (const y of [2, 3, 4]) expect(rev(t, y)).toBeCloseTo(rev(none, y), 9);
    expect(rev(none, 2)).toBeCloseTo(12_000 * 1.03 * 0.5, 9);
  });

  it("free rent at the start doesn't change growth or retention", () => {
    const t = tenant({ freeRentMonths: 3 });
    const none = tenant();
    expect(rev(t, 1)).toBeCloseTo(12_000 * (9 / 12), 9);
    expect(rev(t, 2)).toBeCloseTo(rev(none, 2), 9); // still (1+bump)^1
    expect(rev(t, 4)).toBeCloseTo(rev(none, 4), 9); // retention year unchanged
    expect(rev(t, 4)).toBeCloseTo(12_000 * 1.03 ** 3 * 0.5, 9);
  });

  it("free rent on renewal is weighted by retention and doesn't change growth", () => {
    const t = tenant({ freeRentOnRenewalMonths: 2 });
    const none = tenant();
    expect(rev(t, 3)).toBeCloseTo(rev(none, 3), 9); // lease year untouched
    expect(rev(t, 4)).toBeCloseTo(12_000 * 1.03 ** 3 * (0.5 * (12 - 2)) / 12, 9);
    expect(rev(t, 5)).toBeCloseTo(rev(none, 5), 9);
  });

  it("free rent counts from the effective start, including the lease-up delay", () => {
    const t = tenant({ status: "Pipeline", startMonth: 3, freeRentMonths: 3 });
    const delayed = tenantRevenue(t, 1, { ...ctx, LeaseDelay: 6 }); // starts month 9, free through 12
    expect(delayed).toBe(0);
    expect(tenantRevenue(t, 2, { ...ctx, LeaseDelay: 6 })).toBeCloseTo(12_000 * 1.03, 9);
  });

  it("free rent on renewal does nothing for a tenant with no lease end", () => {
    const t = tenant({ leaseEndMonth: null, retention: null, freeRentOnRenewalMonths: 6 });
    expect(rev(t, 1)).toBeCloseTo(12_000, 9);
  });

  it("zero free rent is the original formula", () => {
    const zero = { ...rendon, rentRoll: rendon.rentRoll.map((t) => ({ ...t, freeRentMonths: 0, freeRentOnRenewalMonths: 0 })) };
    expect(buildCashFlow(zero).totalRevenue).toEqual(buildCashFlow(rendon).totalRevenue);
  });

  it.each([
    ["freeRentMonths", 2.5],
    ["freeRentMonths", -1],
    ["freeRentMonths", 61],
    ["freeRentOnRenewalMonths", 1.5],
    ["freeRentOnRenewalMonths", 99],
  ])("rejects %s = %s", (field, value) => {
    const bad = { ...rendon, rentRoll: rendon.rentRoll.map((t, i) => (i === 0 ? { ...t, [field]: value } : t)) };
    expect(() => runUnderwriting(bad)).toThrow(new RegExp(field as string));
  });

  it("accepts 0 and 60", () => {
    const ok = { ...rendon, rentRoll: rendon.rentRoll.map((t, i) => (i === 0 ? { ...t, freeRentMonths: 60, freeRentOnRenewalMonths: 0 } : t)) };
    expect(() => runUnderwriting(ok)).not.toThrow();
  });
});
