// Screening inputs for a deal: where each value comes from, the comp checks,
// and the side-by-side with the Excel model. Synthetic comps; the model is
// the parsed 7321 Kennedale Pkwy model (one tenant, 5-year lease).

import { describe, expect, it } from "vitest";
import { SQFT_PER_ACRE, type CompRow } from "../comp-adapter";
import { buildDealInputs, checkAgainstComps, compContext, compareWithModel, engineInputs, exitRolloverWarnings, sanitizeInputs, type DealFacts } from "../deal-inputs";
import { runUnderwriting } from "../engine";
import type { UwModelSnapshot } from "../model-snapshot";

const AC = SQFT_PER_ACRE;
const AS_OF = "2026-10-20";
let seq = 0;
const lease = (rentPerAcMo: number, acres: number, esc = 0.04): CompRow => ({
  id: `L${++seq}`, comp_type: "lease", address: `${seq} Lease Rd`, market: "Fort Worth", status: "confirmed", source_ref: "x",
  lot_sf: acres * AC, rent: rentPerAcMo, rent_basis: "per_acre_monthly", lease_type: "nnn", date_commenced: "2025-06-01", escalations_pct: esc,
});
const sale = (perAcre: number, acres: number): CompRow => ({
  id: `S${++seq}`, comp_type: "sale", address: `${seq} Sale Rd`, market: "Fort Worth", status: "confirmed", source_ref: "x",
  lot_sf: acres * AC, sale_price: perAcre * acres, closed_on: "2025-09-01",
});
const ROWS: CompRow[] = [
  ...[5000, 5500, 6000, 6500, 7000, 7500].map((r, i) => lease(r, 6 + i)),
  ...[700_000, 800_000, 850_000, 900_000, 1_000_000].map((p, i) => sale(p, 5 + i)),
];

const facts: DealFacts = {
  property: "7321 Kennedale Pkwy", market: "Fort Worth", state: "TX", acres: 8.7, occupancy: "occupied",
  price: 7_400_000, priceLabel: "Last offer", inPlaceRentAnnual: 660_000, exitCap: null, today: AS_OF,
};

const kennedale: UwModelSnapshot = {
  fileName: "Kennedale UW.xlsx", acquisition: "2027-01-01", holdYears: 5, purchasePrice: 7_500_000, closingCosts: 188_500,
  exitCap: 0.065, goingInCap: 0.0850368, unleveredIrr: 0.151, unleveredMultiple: 1.83, leveredIrr: 0.229, leveredMultiple: 2.57,
  year1Noi: 637_776, vacancyPct: 22_224 / 660_000, reservesYear1: 2400, statedBump: 0.04, capexByYear: [0, 0, 0, 0, 0, 0],
  debt: { ltpp: 0.6, rate: 0.0423304 + 0.0235, ioMonths: 120, amortMonths: 360 },
  leasing: { termYears: 5, freeRentMonths: 1.3, tiNew: 50_000, tiRenew: 25_000, lcNewPct: 0.08, lcRenewPct: 0.08 },
  rentRoll: [{ tenant: "Ansco and Associates", pctSf: 1, start: "2027-01-01", expiration: "2031-12-31", remainingMonths: 60, renewalPct: 0.7, downtimeMonths: 9, rentAnnual: 660_000, marketAnnual: 660_000 }],
};

describe("compContext", () => {
  const c = compContext(ROWS, "Fort Worth", 8.7, AS_OF);
  it("summarises rents, prices and escalations for the market", () => {
    expect(c.rent?.n).toBe(6);
    expect(c.rent?.median).toBe(6250);
    expect(c.sale?.median).toBe(850_000);
    expect(c.escalation?.median).toBeCloseTo(0.04, 10);
    expect(c.exitCap.source).toBe("manual");
  });
  it("has nothing without a market", () => {
    expect(compContext(ROWS, null, 8.7, AS_OF).rent).toBeNull();
  });
});

describe("buildDealInputs from the Excel model", () => {
  const comps = compContext(ROWS, "Fort Worth", 8.7, AS_OF);
  const b = buildDealInputs(facts, kennedale, comps);
  it("takes the model's price, rent roll, debt and hold", () => {
    expect(b.rentRollSource).toBe("model");
    expect(b.inputs.PurchPrice).toBe(7_500_000);
    expect(b.sources.PurchPrice.source).toBe("model");
    expect(b.inputs.Hold).toBe(5);
    expect(b.inputs.IOYrs).toBe(10);
    expect(b.inputs.AmortYrs).toBe(30);
    expect(b.inputs.LoanRate).toBeCloseTo(0.06583, 5);
    const t = b.inputs.rentRoll[0];
    expect(t).toMatchObject({ rent: 660_000, rentPeriod: "Annual", leaseEndMonth: 60, renewalProbOverride: 0.7, newDealDowntimeMonths: 9, newDealFreeRentMonths: 1, acres: 8.7 });
    expect(t.newDealLC).toBe(Math.round(0.08 * 660_000 * 5));
  });
  it("exit cap is the model's, with the workbook's scenario spread", () => {
    expect(b.sources.ExitCap.source).toBe("model");
    expect(b.inputs.levers.ExitCap[0]).toBe(0.065);
    expect(b.inputs.levers.ExitCap[1]).toBeCloseTo(0.06, 10);
    expect(b.inputs.levers.ExitCap[2]).toBeCloseTo(0.0725, 10);
  });
  it("defaults follow the build plan: reassessed taxes, management and reserves above zero", () => {
    expect(b.inputs.TaxSwitch).toBe(1);
    expect(b.inputs.MgmtPct).toBeGreaterThan(0);
    expect(b.inputs.ReservePerAcre).toBeGreaterThan(0);
  });
  it("labels every input", () => {
    for (const s of Object.values(b.sources)) expect(s.note.length).toBeGreaterThan(0);
  });
  it("runs, lands near the model, and compares side by side", () => {
    const run = runUnderwriting(engineInputs(b.inputs));
    expect(run.returns.unleveredIrr).not.toBeNull();
    // Same rent, NNN, similar costs: Yr-1 NOI within 5% of the model's.
    expect(Math.abs(run.returns.year1Noi / 637_776 - 1)).toBeLessThan(0.05);
    const rows = compareWithModel(run, b.inputs, kennedale);
    expect(rows.find((r) => r.label === "Unlevered IRR")?.model).toBe(0.151);
  });
  it("NNN recovery removes landlord taxes; switching it off charges the reassessed tax", () => {
    const nnn = runUnderwriting(engineInputs(b.inputs)).returns;
    const gross = runUnderwriting(engineInputs({ ...b.inputs, NnnRecovered: false })).returns;
    expect(nnn.reassessedYear1Tax).toBe(0);
    expect(gross.year1Noi).toBeLessThan(nnn.year1Noi - 0.02 * 7_500_000 * 0.9);
  });
});

describe("buildDealInputs without a model", () => {
  const comps = compContext(ROWS, "Fort Worth", 8.7, AS_OF);
  it("occupied: the deal's in-place rent, no expiry, flagged", () => {
    const b = buildDealInputs(facts, null, comps);
    expect(b.rentRollSource).toBe("in-place");
    expect(b.inputs.rentRoll[0].rent).toBe(55_000);
    expect(b.inputs.rentRoll[0].leaseEndMonth).toBeNull();
    expect(b.inputs.PurchPrice).toBe(7_400_000);
    expect(b.sources.PurchPrice.source).toBe("deal");
    expect(b.warnings.some((w) => /no lease end/.test(w))).toBe(true);
  });
  it("vacant: one lease-up tenant at the median comp rent", () => {
    const b = buildDealInputs({ ...facts, occupancy: "vacant", inPlaceRentAnnual: null }, null, comps);
    expect(b.rentRollSource).toBe("lease-up");
    expect(b.inputs.rentRoll[0]).toMatchObject({ status: "Pipeline", rent: Math.round(6250 * 8.7), startMonth: 6 });
    expect(b.sources.rentRoll.source).toBe("comps");
  });
  it("no price anywhere: price from sale comps x acres", () => {
    const b = buildDealInputs({ ...facts, price: null }, null, comps);
    expect(b.inputs.PurchPrice).toBe(Math.round(850_000 * 8.7));
    expect(b.sources.PurchPrice.source).toBe("comps");
  });
  it("no exit cap anywhere: placeholder, warned", () => {
    const b = buildDealInputs(facts, null, comps);
    expect(b.sources.ExitCap.source).toBe("default");
    expect(b.warnings.some((w) => /placeholder/.test(w))).toBe(true);
  });
  it("the deal's own exit cap wins over the model's", () => {
    const b = buildDealInputs({ ...facts, exitCap: 0.07 }, kennedale, comps);
    expect(b.inputs.levers.ExitCap[0]).toBe(0.07);
    expect(b.sources.ExitCap.source).toBe("deal");
  });
});

describe("checkAgainstComps", () => {
  const comps = compContext(ROWS, "Fort Worth", 8.7, AS_OF);
  it("flags a price and a rent outside the middle half of comps", () => {
    const b = buildDealInputs({ ...facts, price: 12_000_000 }, null, comps);
    const checks = checkAgainstComps(b.inputs, comps);
    expect(checks.find((c) => c.key === "PurchPrice")?.message).toMatch(/above/);
    expect(checks.some((c) => c.key === "tenant:0")).toBe(false); // $6,322/ac/mo is inside 5,625-6,875
    const low = checkAgainstComps({ ...b.inputs, rentRoll: [{ ...b.inputs.rentRoll[0], rent: 20_000 }] }, comps);
    expect(low.find((c) => c.key === "tenant:0")?.message).toMatch(/below/);
  });
  it("quiet when values sit inside the comps", () => {
    const b = buildDealInputs(facts, null, comps);
    expect(checkAgainstComps(b.inputs, comps).filter((c) => c.key === "PurchPrice")).toEqual([]);
  });
});

describe("exitRolloverWarnings", () => {
  const b = buildDealInputs(facts, kennedale, compContext(ROWS, "Fort Worth", 8.7, AS_OF));
  it("carries the model's stated bump", () => {
    expect(b.inputs.rentRoll[0].bump).toBe(0.04);
  });
  it("warns when a lease ends around the sale", () => {
    expect(exitRolloverWarnings(b.inputs)).toHaveLength(1);
    expect(exitRolloverWarnings({ ...b.inputs, Hold: 3 })).toHaveLength(0);
  });
});

describe("sanitizeInputs", () => {
  const b = buildDealInputs(facts, kennedale, compContext(ROWS, "Fort Worth", 8.7, AS_OF));
  it("keeps a built run intact (through JSON, as the browser sends it)", () => {
    const back = sanitizeInputs(JSON.parse(JSON.stringify(b.inputs)));
    expect(typeof back).not.toBe("string");
    expect(runUnderwriting(engineInputs(back as any)).returns).toEqual(runUnderwriting(engineInputs(b.inputs)).returns);
  });
  it("rejects bad fields and drops unknown ones", () => {
    expect(sanitizeInputs({ ...b.inputs, Hold: 11 })).toBe("bad input: Hold");
    expect(sanitizeInputs({ ...b.inputs, PurchPrice: "1e6" })).toBe("bad input: PurchPrice");
    expect(sanitizeInputs({ ...b.inputs, rentRoll: [{ ...b.inputs.rentRoll[0], newDealDowntimeMonths: 2.5 }] })).toBe("bad input: rent roll row 1");
    const extra = sanitizeInputs({ ...b.inputs, evil: "x" }) as any;
    expect(extra.evil).toBeUndefined();
  });
});
