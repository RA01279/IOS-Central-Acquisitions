import { describe, expect, it } from "vitest";
import { convertTenantRentPeriod, createUwDraft, restoreUwSnapshot } from "../draft";
import { annualRent, runUnderwriting } from "../engine";
import { rendon } from "../fixtures/rendon";
import { buildUwView } from "../view-model";

describe("deal-specific IOS drafts", () => {
  it("matches an independently calculated IOS owner cash flow", () => {
    const initial = createUwDraft({ id: "synthetic", property: "Synthetic IOS", price: 2_000_000, acres: 12.5, priceSource: "ask" });
    const result = runUnderwriting({ ...initial, TaxRate: 0.02, Insurance: 10_000, MgmtPct: 0.03, ReservePerAcre: 100, OtherOpex: 5_000, LevOn: 0,
      rentRoll: [{ ...rendon.rentRoll[0], rent: 20_000, rentPeriod: "Monthly", acres: 12.5, bump: null, leaseEndMonth: null, retention: null }] });
    // 240,000 rent - 12,000 vacancy - 40,000 tax - 10,000 insurance
    // - 6,840 management - 5,000 other = 166,160 NOI; less 1,250 reserves.
    expect(result.returns.year1Noi).toBe(166_160);
    expect(result.cashFlow.unleveredCF[1]).toBe(164_910);
    expect(result.cashFlow.leveredCF[1]).toBe(164_910);
  });
  it("restores inputs and recalculates rather than trusting saved returns", () => {
    const seed = { id: "deal", property: "Actual property", price: null, acres: null, priceSource: "none" };
    const snapshot = { schema: "hopper-ios-uw-v1", dealId: "deal", sample: true, vacant: false, capitalReviewed: true, inputs: rendon, results: { kpis: [{ key: "unleveredIrr", value: 9.99 }] } };
    const restored = restoreUwSnapshot(JSON.stringify(snapshot), seed);
    expect(restored.view.kpis.find(k => k.key === "unleveredIrr")!.value).toBeCloseTo(0.105295, 6);
    expect(restored.inputs).toEqual(rendon);
    expect(() => restoreUwSnapshot(JSON.stringify({ ...snapshot, dealId: "another-deal" }), seed)).toThrow(/does not belong/);
    expect(() => restoreUwSnapshot(JSON.stringify({ ...snapshot, sample: false }), seed)).toThrow(/property does not match/);
    expect(() => restoreUwSnapshot(JSON.stringify({ ...snapshot, inputs: { ...rendon, Insurance: null } }), seed)).toThrow(/Insurance/);
  });
  it("starts with deal facts and no sample tenants or hidden zero operating costs", () => {
    const draft = createUwDraft({ id: "deal", property: "Real deal", price: 2_000_000, acres: 12.5, priceSource: "ask" });
    expect(draft.property).toBe("Real deal");
    expect(draft.PurchPrice).toBe(2_000_000);
    expect(draft.Acres).toBe(12.5);
    expect(draft.rentRoll).toEqual([]);
    expect(draft.TaxSwitch).toBe(1);
    expect(Number.isNaN(draft.Insurance)).toBe(true);
    expect(Number.isNaN(draft.MgmtPct)).toBe(true);
    expect(Number.isNaN(draft.ReservePerAcre)).toBe(true);
    expect(() => runUnderwriting(draft)).toThrow();
  });
  it("leaves missing purchase price and acreage unresolved", () => {
    const draft = createUwDraft({ id: "deal", property: "Unknown", price: null, acres: null, priceSource: "none" });
    expect(Number.isNaN(draft.PurchPrice)).toBe(true);
    expect(Number.isNaN(draft.Acres)).toBe(true);
  });
  it("preserves economics when switching monthly and annual rent, including rollover", () => {
    const monthly = { ...rendon.rentRoll[0], rent: 4000, renewalRent: 4500, newDealRent: 5000 };
    const annual = convertTenantRentPeriod(monthly, "Annual");
    expect(annual.rent).toBe(48_000);
    expect(annual.renewalRent).toBe(54_000);
    expect(annual.newDealRent).toBe(60_000);
    expect(annualRent(annual)).toBe(annualRent(monthly));
    expect(convertTenantRentPeriod(annual, "Monthly")).toEqual(monthly);
    const base = { ...rendon, RollMethod: 2 as const, rentRoll: [monthly], capex: [] };
    expect(runUnderwriting({ ...base, rentRoll: [annual] }).cashFlow.totalRevenue).toEqual(runUnderwriting(base).cashFlow.totalRevenue);
  });
  it("reconciles the displayed exit bridge, tenant revenue and itemized owner costs", () => {
    const v = buildUwView(rendon);
    expect(v.audit.forwardNoi / v.audit.exitCap).toBeCloseTo(v.audit.grossExit, 6);
    expect(v.audit.grossExit + v.audit.saleCosts + v.audit.debtPayoff).toBeCloseTo(v.audit.equitySale, 6);
    const rows = (label: string) => v.cashFlow.find(r => r.label === label)!;
    expect(v.tenants.reduce((sum, t) => sum + t.year1Revenue, 0)).toBeCloseTo(rows("Total scenario revenue").values[1]!, 8);
    for (let y = 1; y <= v.hold; y++) {
      const expense = ["Property taxes", "Insurance", "Management fee", "Other operating expenses"].reduce((sum, label) => sum + rows(label).values[y]!, 0);
      expect(expense).toBeCloseTo(rows("Operating expenses").values[y]!, 8);
    }
  });
  it("shows rollover notes matching the selected calculation method", () => {
    expect(buildUwView({ ...rendon, RollMethod: 2 }).modelNotes[0]).toMatch(/renewal probability/);
  });
});
