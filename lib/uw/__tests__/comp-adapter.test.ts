// Comp adapter on synthetic comps only.

import { describe, expect, it } from "vitest";
import {
  adaptComps,
  bandOf,
  normalizeAddress,
  normalizeEscalation,
  normalizeLease,
  normalizeSale,
  SQFT_PER_ACRE,
  tierOf,
  type CompRow,
  type LeaseComp,
} from "../comp-adapter";

const AC = SQFT_PER_ACRE;
let seq = 0;
const lease = (over: Partial<CompRow> = {}): CompRow => ({
  id: `L${++seq}`,
  comp_type: "lease",
  address: `${seq} Test Rd`,
  market: "Testville",
  status: "confirmed",
  source_ref: "synthetic",
  lot_sf: 2 * AC,
  building_sf: 10_000,
  rent: 8_000,
  rent_basis: "per_acre_monthly",
  lease_type: "nnn",
  date_commenced: "2025-06-01",
  ...over,
});
const sale = (over: Partial<CompRow> = {}): CompRow => ({
  id: `S${++seq}`,
  comp_type: "sale",
  address: `${seq} Sale St`,
  market: "Testville",
  status: "confirmed",
  source_ref: "synthetic",
  lot_sf: 4 * AC,
  sale_price: 4_000_000,
  closed_on: "2025-06-01",
  ...over,
});

describe("rent_basis conversions to $/acre/month (acres = lot_sf / 43560)", () => {
  it("per_acre_monthly is already $/acre/month", () => {
    expect(normalizeLease(lease({ rent: 8_000, rent_basis: "per_acre_monthly" })).rentPerAcreMo).toBe(8_000);
  });
  it("total_monthly divides by acres", () => {
    expect(normalizeLease(lease({ rent: 20_000, rent_basis: "total_monthly", lot_sf: 2.5 * AC })).rentPerAcreMo).toBeCloseTo(8_000, 9);
  });
  it("per_sf_bldg_monthly multiplies by building SF", () => {
    expect(normalizeLease(lease({ rent: 1.2, rent_basis: "per_sf_bldg_monthly", building_sf: 10_000, lot_sf: 2 * AC })).rentPerAcreMo).toBeCloseTo(6_000, 9);
  });
  it("per_sf_bldg_annual multiplies by building SF and divides by 12", () => {
    expect(normalizeLease(lease({ rent: 14.4, rent_basis: "per_sf_bldg_annual", building_sf: 10_000, lot_sf: 2 * AC })).rentPerAcreMo).toBeCloseTo(6_000, 9);
  });
  it("per_sf_land_monthly is per land SF: x 43,560", () => {
    expect(normalizeLease(lease({ rent: 0.2, rent_basis: "per_sf_land_monthly", lot_sf: 3 * AC })).rentPerAcreMo).toBeCloseTo(0.2 * AC, 9);
  });
  it("ignores yard_acres entirely", () => {
    const c = normalizeLease({ ...lease({ rent: 20_000, rent_basis: "total_monthly", lot_sf: 4 * AC }), yard_acres: 1 } as CompRow);
    expect(c.acres).toBe(4);
    expect(c.rentPerAcreMo).toBe(5_000);
  });
  it("is not_convertible when the area a basis needs is missing", () => {
    for (const row of [
      lease({ rent_basis: "per_sf_bldg_annual", rent: 12, building_sf: null }),
      lease({ rent_basis: "total_monthly", rent: 20_000, lot_sf: null }),
      lease({ rent_basis: "per_acre_monthly", lot_sf: null }),
      lease({ rent_basis: "per_sf_bldg_monthly", rent: 1, building_sf: 5_000, lot_sf: null }),
    ]) {
      const c = normalizeLease(row);
      expect(c.rentPerAcreMo).toBeNull();
      expect(c.nnnStatus).toBe("not_convertible");
      expect(c.flags).toContain("not_convertible");
      expect(c.reasons.not_convertible).toBeTruthy();
    }
  });
});

describe("nnnStatus", () => {
  it("stated for nnn and absolute_net", () => {
    expect(normalizeLease(lease({ lease_type: "nnn" })).nnnStatus).toBe("stated");
    expect(normalizeLease(lease({ lease_type: "absolute_net" })).nnnStatus).toBe("stated");
  });
  it("stated_nn for nn, rent unchanged", () => {
    const c = normalizeLease(lease({ lease_type: "nn", rent: 7_000 }));
    expect(c.nnnStatus).toBe("stated_nn");
    expect(c.rentPerAcreMo).toBe(7_000);
  });
  it("assumed (treated as NNN) when lease_type is blank", () => {
    for (const lt of [null, ""]) {
      const c = normalizeLease(lease({ lease_type: lt, rent: 7_000 }));
      expect(c.nnnStatus).toBe("assumed");
      expect(c.rentPerAcreMo).toBe(7_000);
    }
  });
  it("adjusted: gross / modified gross minus CAM x building SF / 12, per acre", () => {
    // 2 ac, $10,000/ac/mo gross; CAM $1.20/SF/yr on 10,000 SF = $1,000/mo = $500/ac/mo.
    for (const lt of ["gross", "modified_gross"]) {
      const c = normalizeLease(lease({ lease_type: lt, rent: 10_000, cam_psf_annual: 1.2, building_sf: 10_000, lot_sf: 2 * AC }));
      expect(c.nnnStatus).toBe("adjusted");
      expect(c.rentPerAcreMo).toBeCloseTo(9_500, 9);
    }
  });
  it("not_convertible: gross without CAM or building SF, and unknown structures", () => {
    expect(normalizeLease(lease({ lease_type: "gross", cam_psf_annual: null })).nnnStatus).toBe("not_convertible");
    expect(normalizeLease(lease({ lease_type: "modified_gross", cam_psf_annual: 1, building_sf: null })).nnnStatus).toBe("not_convertible");
    const other = normalizeLease(lease({ lease_type: "other" }));
    expect(other.nnnStatus).toBe("not_convertible");
    expect(other.rentPerAcreMo).toBeNull();
  });
});

describe("escalation normalization", () => {
  it("values above 1 are whole percents", () => {
    expect(normalizeEscalation(3)).toBeCloseTo(0.03, 12);
    expect(normalizeEscalation("3.5")).toBeCloseTo(0.035, 12);
    expect(normalizeEscalation(0.04)).toBe(0.04);
    expect(normalizeEscalation(1)).toBe(1);
    expect(normalizeEscalation(0)).toBe(0);
    expect(normalizeEscalation(null)).toBeNull();
    expect(normalizeLease(lease({ escalations_pct: 4 })).escalation).toBeCloseTo(0.04, 12);
  });
});

describe("sale comps", () => {
  it("price per lot acre", () => {
    expect(normalizeSale(sale({ sale_price: 3_000_000, lot_sf: 2 * AC })).pricePerAcre).toBe(1_500_000);
  });
  it("cap rate: stored, else NOI / price, else null", () => {
    expect(normalizeSale(sale({ cap_rate: 0.065, noi: 1 })).capRate).toBe(0.065);
    const fromNoi = normalizeSale(sale({ sale_price: 4_000_000, noi: 280_000 }));
    expect(fromNoi.capRate).toBeCloseTo(0.07, 12);
    expect(fromNoi.capRateSource).toBe("noi");
    const none = normalizeSale(sale());
    expect(none.capRate).toBeNull();
    expect(none.capRateSource).toBeNull();
  });
  it("not_convertible without lot_sf", () => {
    const c = normalizeSale(sale({ lot_sf: null }));
    expect(c.pricePerAcre).toBeNull();
    expect(c.flags).toEqual(["not_convertible"]);
  });
});

describe("every output keeps its provenance", () => {
  it("id, date, market, submarket, source_ref", () => {
    const l = normalizeLease(lease({ id: "x1", submarket: "North", source_ref: "Broker A", date_commenced: "2024-02-01" }));
    expect([l.id, l.date, l.market, l.submarket, l.sourceRef]).toEqual(["x1", "2024-02-01", "Testville", "North", "Broker A"]);
    const s = normalizeSale(sale({ id: "x2", submarket: "South", source_ref: "Broker B", closed_on: "2024-03-01" }));
    expect([s.id, s.date, s.market, s.submarket, s.sourceRef]).toEqual(["x2", "2024-03-01", "Testville", "South", "Broker B"]);
  });
});

describe("suspect_duplicate", () => {
  it("normalizes address spellings", () => {
    expect(normalizeAddress("3912 Euless South Main St.")).toBe(normalizeAddress("3912 euless s main st"));
    expect(normalizeAddress("100 Main Road")).toBe("100 main rd");
  });

  it("flags the older of two same-address, same-rent comps within 400 days and keeps the latest", () => {
    const [a, b] = adaptComps([
      lease({ id: "old", address: "10 Elm Road", rent: 9_000, date_commenced: "2024-04-01" }),
      lease({ id: "new", address: "10 Elm Rd.", rent: 9_000, date_commenced: "2024-04-24" }),
    ]);
    expect(a.flags).toContain("suspect_duplicate");
    expect(a.reasons.suspect_duplicate).toContain("new");
    expect(b.flags).not.toContain("suspect_duplicate");
  });

  it("catches a pair about a year apart, but not beyond ~400 days", () => {
    const near = adaptComps([
      lease({ id: "a", address: "1 X Rd", date_commenced: "2023-10-01" }),
      lease({ id: "b", address: "1 X Rd", date_commenced: "2024-10-23" }),
    ]);
    expect(near.find((c) => c.id === "a")!.flags).toContain("suspect_duplicate");
    const far = adaptComps([
      lease({ id: "c", address: "2 X Rd", date_commenced: "2022-06-01" }),
      lease({ id: "d", address: "2 X Rd", date_commenced: "2024-01-01" }),
    ]);
    expect(far.every((c) => !c.flags.includes("suspect_duplicate"))).toBe(true);
  });

  it("does not flag different rents, different suites, different projects, or lease vs sale", () => {
    const out = adaptComps([
      lease({ id: "r1", address: "3 X Rd", rent: 8_000 }),
      lease({ id: "r2", address: "3 X Rd", rent: 8_500 }),
      lease({ id: "s1", address: "4 X Rd", suite: "A" }),
      lease({ id: "s2", address: "4 X Rd", suite: "B" }),
      sale({ id: "p1", address: "5 X Rd", project_name: "Bldg C", closed_on: "2026-03-20" }),
      sale({ id: "p2", address: "5 X Rd", project_name: "Bldg D", closed_on: "2026-03-20" }),
    ]);
    expect(out.every((c) => !c.flags.includes("suspect_duplicate"))).toBe(true);
  });

  it("flags same-price sale duplicates", () => {
    const out = adaptComps([
      sale({ id: "s-old", address: "9 Hwy 105 E", sale_price: 1_675_000, closed_on: "2025-03-01" }),
      sale({ id: "s-new", address: "9 Highway 105 East", sale_price: 1_675_000, closed_on: "2026-03-01" }),
    ]);
    expect(out.find((c) => c.id === "s-old")!.flags).toContain("suspect_duplicate");
    expect(out.find((c) => c.id === "s-new")!.flags).not.toContain("suspect_duplicate");
  });
});

describe("review_extreme", () => {
  it("flags values over 5x or under 1/5 of the market-band median, keeping them", () => {
    const rents = [8_000, 8_200, 7_800, 8_100, 50_000, 1_000];
    const out = adaptComps(rents.map((rent, i) => lease({ id: `e${i}`, rent, address: `${i} Band St` }))) as LeaseComp[];
    const flagged = out.filter((c) => c.flags.includes("review_extreme")).map((c) => c.id);
    expect(flagged.sort()).toEqual(["e4", "e5"]);
    expect(out.find((c) => c.id === "e4")!.rentPerAcreMo).toBe(50_000);
  });

  it("compares within band and market only", () => {
    const out = adaptComps([
      ...[1, 2, 3].map((i) => lease({ id: `small${i}`, rent: 8_000, lot_sf: 2 * AC, address: `${i} S St` })),
      lease({ id: "big", rent: 1_500, lot_sf: 40 * AC, address: "Big Lot" }),
      lease({ id: "other-mkt", rent: 1_500, market: "Elsewhere", address: "Far Rd" }),
    ]);
    expect(out.every((c) => !c.flags.includes("review_extreme"))).toBe(true);
  });
});

describe("bands and tiers", () => {
  it("acreage bands <3, 3-10, 10-25, 25+", () => {
    expect([0.5, 2.99, 3, 9.99, 10, 24.99, 25, 100].map(bandOf)).toEqual(["<3", "<3", "3-10", "3-10", "10-25", "10-25", "25+", "25+"]);
    expect(bandOf(null)).toBeNull();
  });

  it("screened needs confirmed, no dup/extreme, a source_ref and acreage", () => {
    expect(tierOf(normalizeLease(lease()))).toBe("screened");
    expect(tierOf(normalizeLease(lease({ source_ref: null })))).toBe("confirmed");
    expect(tierOf(normalizeLease(lease({ lot_sf: null })))).toBe("confirmed");
    expect(tierOf(normalizeLease(lease({ status: "draft" })))).toBeNull();
  });
});
