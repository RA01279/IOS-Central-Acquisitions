// Comp stats and mark-to-market on synthetic comps only.

import { describe, expect, it } from "vitest";
import { adaptComps, SQFT_PER_ACRE, type CompRow, type LeaseComp, type SaleComp } from "../comp-adapter";
import { exitCapStats, markToMarket, percentile, rentBands, selectComps, valueStats } from "../comp-stats";
import type { Tenant } from "../types";

const AC = SQFT_PER_ACRE;
const AS_OF = "2026-10-08";
let seq = 0;

const lease = (rent: number, acres: number, over: Partial<CompRow> = {}): CompRow => ({
  id: `L${++seq}`,
  comp_type: "lease",
  address: `${seq} Synthetic Rd`,
  market: "Testville",
  status: "confirmed",
  source_ref: "synthetic",
  lot_sf: acres * AC,
  rent,
  rent_basis: "per_acre_monthly",
  lease_type: "nnn",
  date_commenced: "2025-06-01",
  ...over,
});
const sale = (pricePerAcre: number, acres: number, over: Partial<CompRow> = {}): CompRow => ({
  id: `S${++seq}`,
  comp_type: "sale",
  address: `${seq} Synthetic Sale`,
  market: "Testville",
  status: "confirmed",
  source_ref: "synthetic",
  lot_sf: acres * AC,
  sale_price: pricePerAcre * acres,
  closed_on: "2025-06-01",
  ...over,
});

const leasesFrom = (rows: CompRow[]) => adaptComps(rows).filter((c): c is LeaseComp => c.compType === "lease");
const salesFrom = (rows: CompRow[]) => adaptComps(rows).filter((c): c is SaleComp => c.compType === "sale");
const usableLeases = (rows: CompRow[]) => selectComps(leasesFrom(rows), "lease", { market: "Testville", asOf: AS_OF }).usable;

describe("percentile (PERCENTILE.INC)", () => {
  it("interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(percentile([4, 1, 3, 2], 0.5)).toBeCloseTo(2.5, 12);
    expect(percentile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 12);
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([7], 0.25)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("selection", () => {
  const rows = [
    lease(8_000, 2, { id: "in" }),
    lease(8_000, 2, { id: "other-market", market: "Elsewhere" }),
    lease(8_000, 2, { id: "draft", status: "draft" }),
    lease(8_000, 2, { id: "old", date_commenced: "2023-06-01" }),
    lease(8_000, 2, { id: "30mo", date_commenced: "2024-04-08" }),
    lease(8_000, 2, { id: "case", market: " testville " }),
    lease(8_000, 2, { id: "nc", lease_type: "other" }),
  ];

  it("market (case-insensitive), status confirmed, last 36 months", () => {
    const sel = selectComps(leasesFrom(rows), "lease", { market: "Testville", asOf: AS_OF });
    expect(sel.usable.map((c) => c.id).sort()).toEqual(["30mo", "case", "in"]);
    expect(sel.excluded.notConvertible.map((c) => c.id)).toEqual(["nc"]);
    expect(sel.windowStart).toBe("2023-10-08");
  });

  it("24-month option", () => {
    const sel = selectComps(leasesFrom(rows), "lease", { market: "Testville", asOf: AS_OF, months: 24 });
    expect(sel.usable.map((c) => c.id).sort()).toEqual(["case", "in"]);
  });

  it("leaves suspect duplicates out and counts tiers", () => {
    const sel = selectComps(
      leasesFrom([
        lease(9_000, 2, { id: "keep", address: "1 Dup Rd", date_commenced: "2024-04-24" }),
        lease(9_000, 2, { id: "dup", address: "1 Dup Road", date_commenced: "2024-04-01" }),
        lease(9_000, 2, { id: "nosrc", source_ref: null }),
      ]),
      "lease",
      { market: "Testville", asOf: AS_OF }
    );
    expect(sel.usable.map((c) => c.id).sort()).toEqual(["keep", "nosrc"]);
    expect(sel.excluded.duplicate.map((c) => c.id)).toEqual(["dup"]);
    expect(sel.tiers).toEqual({ confirmed: 3, screened: 1, verified: 0 });
  });
});

describe("band selection and fallback", () => {
  const small = [6_000, 7_000, 8_000, 9_000, 10_000].map((r) => lease(r, 2));
  const mid = [4_000, 4_500].map((r) => lease(r, 5));

  it("uses the subject's band when it has 5+ comps", () => {
    const s = valueStats(usableLeases([...small, ...mid]), "lease", 1.5);
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    expect(s.basis).toBe("band");
    expect(s.subjectBand).toBe("<3");
    expect(s.withExtreme.n).toBe(5);
    expect([s.withExtreme.downside, s.withExtreme.base, s.withExtreme.upside]).toEqual([7_000, 8_000, 9_000]);
    expect([s.withExtreme.min, s.withExtreme.max]).toEqual([6_000, 10_000]);
    expect(s.withExtreme.compIds).toHaveLength(5);
  });

  it("falls back to the whole market, with a warning, when the band has fewer than 5", () => {
    const s = valueStats(usableLeases([...small, ...mid]), "lease", 6);
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    expect(s.basis).toBe("market");
    expect(s.withExtreme.n).toBe(7);
    expect(s.warnings.some((w) => /Only 2 lease comps in the 3-10 ac band/.test(w))).toBe(true);
  });

  it("warns when the subject is outside the acreage range of the comps used", () => {
    const s = valueStats(usableLeases([...small, ...mid]), "lease", 37);
    expect(s.status === "ok" && s.warnings.some((w) => /outside the 2-5 ac range/.test(w))).toBe(true);
  });

  it("returns insufficient comps when the market has fewer than 5", () => {
    const s = valueStats(usableLeases(small.slice(0, 4)), "lease", 2);
    expect(s.status).toBe("insufficient");
    if (s.status === "insufficient") {
      expect(s.n).toBe(4);
      expect(s.message).toMatch(/insufficient comps/);
    }
  });
});

describe("with and without review_extreme / assumed NNN", () => {
  it("reports both", () => {
    const rows = [8_000, 8_200, 7_800, 8_100, 8_300, 50_000].map((r) => lease(r, 2));
    const s = valueStats(usableLeases(rows), "lease", 2);
    if (s.status !== "ok") throw new Error("expected ok");
    expect(s.withExtreme.n).toBe(6);
    expect(s.withoutExtreme!.n).toBe(5);
    expect(s.extremeIds).toHaveLength(1);
    expect(s.withoutExtreme!.max).toBe(8_300);
  });

  it("separates assumed-NNN leases", () => {
    const rows = [
      ...[7_000, 8_000, 9_000].map((r) => lease(r, 2)),
      ...[10_000, 11_000].map((r) => lease(r, 2, { lease_type: null })),
    ];
    const s = valueStats(usableLeases(rows), "lease", 2);
    if (s.status !== "ok") throw new Error("expected ok");
    expect(s.withExtreme.n).toBe(5);
    expect(s.withoutAssumedNnn!.n).toBe(3);
    expect(s.withoutAssumedNnn!.base).toBe(8_000);
    expect(s.warnings.some((w) => /2 of 5 lease comps .* assumed NNN/.test(w))).toBe(true);
  });
});

describe("price per acre and exit cap", () => {
  it("price per acre p25 / median / p75 become downside / base / upside", () => {
    const rows = [800_000, 900_000, 1_000_000, 1_100_000, 1_200_000].map((p) => sale(p, 4));
    const usable = selectComps(salesFrom(rows), "sale", { market: "Testville", asOf: AS_OF }).usable;
    const s = valueStats(usable, "sale", 4);
    if (s.status !== "ok") throw new Error("expected ok");
    expect([s.withExtreme.downside, s.withExtreme.base, s.withExtreme.upside]).toEqual([900_000, 1_000_000, 1_100_000]);
  });

  it("exit cap is manual with fewer than 5 cap rates", () => {
    const usable = salesFrom([1, 2, 3, 4].map((i) => sale(1_000_000, 4, { cap_rate: 0.06 + i / 1000 })));
    expect(exitCapStats(usable)).toMatchObject({ source: "manual", n: 4 });
    expect(exitCapStats(salesFrom([sale(1_000_000, 4)]))).toMatchObject({ source: "manual", n: 0 });
  });

  it("exit cap from 5+ comps: downside is the 75th percentile (higher cap)", () => {
    const usable = salesFrom([0.06, 0.065, 0.07, 0.075, 0.08].map((cap_rate) => sale(1_000_000, 4, { cap_rate })));
    const s = exitCapStats(usable);
    expect(s.source).toBe("comps");
    if (s.source !== "comps") return;
    expect(s.downside).toBeCloseTo(0.075, 12);
    expect(s.base).toBeCloseTo(0.07, 12);
    expect(s.upside).toBeCloseTo(0.065, 12);
  });
});

describe("markToMarket", () => {
  const tenant = (name: string, acres: number | null, rent: number, rentPeriod: Tenant["rentPeriod"] = "Monthly"): Tenant => ({
    name, status: "In-place", acres, rent, rentPeriod, bump: null, startMonth: 0, leaseEndMonth: null, retention: null, include: [1, 1, 1],
  });
  const comps = usableLeases([
    ...[6_000, 7_000, 8_000, 9_000, 10_000].map((r) => lease(r, 2)),
    ...[5_000, 6_000].map((r) => lease(r, 5)),
  ]);
  const bands = rentBands(comps, "Testville");

  it("positions each tenant against its own band's p25 / median / p75", () => {
    const rows = markToMarket(
      [tenant("Low", 2, 12_000), tenant("Mid", 1, 8_000), tenant("High", 0.5, 6_000), tenant("Annual", 1, 96_000, "Annual")],
      bands
    );
    expect(rows.map((r) => r.position)).toEqual(["below", "within", "above", "within"]);
    expect(rows[0].rentPerAcreMo).toBe(6_000);
    expect(rows[0].vsMedian).toBeCloseTo(-0.25, 12);
    expect(rows[0].basis).toBe("band");
  });

  it("tenants without acres are n/a", () => {
    const [r] = markToMarket([tenant("No acres", null, 5_000)], bands);
    expect(r.position).toBe("n/a");
    expect(r.rentPerAcreMo).toBeNull();
  });

  it("falls back to the market, and says so, when the tenant's band is thin", () => {
    const [r] = markToMarket([tenant("Mid-size", 5, 30_000)], bands);
    expect(r.basis).toBe("market");
    expect(r.note).toMatch(/fewer than 5/);
  });

  it("is n/a when the market itself is insufficient", () => {
    const thin = rentBands(comps.slice(0, 3), "Testville");
    const [r] = markToMarket([tenant("Any", 2, 16_000)], thin);
    expect(r.position).toBe("n/a");
    expect(r.note).toMatch(/insufficient/);
  });
});
