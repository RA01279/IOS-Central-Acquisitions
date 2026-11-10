import { describe, expect, it } from "vitest";
import { aerialUrl, compsWithin, dedupeComps, parseRadiusQuery, type RadiusComp } from "./radius";

// Downtown Houston, and points roughly 1, 4 and 12 miles north of it.
const center = { lat: 29.7604, lng: -95.3698 };
const north = (miles: number) => center.lat + miles / 69;
const comp = (id: string, miles: number, extra: Partial<RadiusComp> = {}): RadiusComp => ({
  id, comp_type: "lease", status: "confirmed", latitude: north(miles), longitude: center.lng,
  geocode_precision: "rooftop", asset_class: "ios", ...extra,
});

describe("compsWithin", () => {
  const rows = [
    comp("far", 12),
    comp("near", 1),
    comp("mid-sale", 4, { comp_type: "sale" }),
    comp("draft", 1, { status: "draft" }),
    comp("vague", 1, { geocode_precision: "approximate" }),
    comp("portfolio-total", 1, { is_portfolio: true }),
    comp("portfolio-site", 2, { portfolio_transaction_id: "p1" }),
    comp("industrial", 3, { asset_class: "industrial" }),
    comp("no-pin", 1, { latitude: null, longitude: null }),
  ];

  it("keeps confirmed, measurable comps inside the radius, nearest first", () => {
    expect(compsWithin(rows, center, 5, "both").map((c) => c.id)).toEqual(["near", "portfolio-site", "industrial", "mid-sale"]);
  });
  it("filters by comp type", () => {
    expect(compsWithin(rows, center, 5, "sale").map((c) => c.id)).toEqual(["mid-sale"]);
    expect(compsWithin(rows, center, 5, "lease").map((c) => c.id)).not.toContain("mid-sale");
  });
  it("filters by asset class", () => {
    expect(compsWithin(rows, center, 5, "both", "industrial").map((c) => c.id)).toEqual(["industrial"]);
  });
  it("reports the distance in miles", () => {
    const [near] = compsWithin(rows, center, 5, "lease");
    expect(near.distanceMiles).toBeGreaterThan(0.95);
    expect(near.distanceMiles).toBeLessThan(1.05);
  });
  it("widening the radius picks up farther comps", () => {
    expect(compsWithin(rows, center, 15, "both").map((c) => c.id)).toContain("far");
  });
});

describe("parseRadiusQuery", () => {
  it("accepts a normal search and defaults to both types and all classes", () => {
    expect(parseRadiusQuery({ address: " 1 Main St, Houston TX ", miles: "5" })).toEqual({ ok: true, address: "1 Main St, Houston TX", miles: 5, type: "both", assetClass: "all" });
  });
  it("rejects a missing address or a silly radius", () => {
    expect(parseRadiusQuery({ address: "", miles: "5" }).ok).toBe(false);
    expect(parseRadiusQuery({ address: "x", miles: "0" }).ok).toBe(false);
    expect(parseRadiusQuery({ address: "x", miles: "500" }).ok).toBe(false);
    expect(parseRadiusQuery({ address: "x", miles: "abc" }).ok).toBe(false);
  });
});

describe("aerialUrl", () => {
  it("opens Google Maps on the satellite view at the point", () => {
    const u = new URL(aerialUrl(29.76, -95.37));
    expect(u.hostname).toBe("www.google.com");
    expect(u.searchParams.get("basemap")).toBe("satellite");
    expect(u.searchParams.get("center")).toBe("29.760000,-95.370000");
  });
});

describe("dedupeComps", () => {
  const base = { comp_type: "lease", address: "3403 N Sam Houston Pkwy. W", suite: null, project_name: null, latitude: 29.9, longitude: -95.5, date_commenced: "2026-01-01", rent: 1.18, tenant_name: "Roto-Rooter", sale_price: null, closed_on: null, buyer: null };
  it("merges the same lease imported twice, keeping the fuller copy and filling its gaps", () => {
    const rows = [
      { ...base, id: "old", building_sf: null, created_at: "2026-10-27", escalations_pct: 3 },
      { ...base, id: "new", address: "3403 N Sam Houston Pkwy W", building_sf: 11998, ti_psf: 2, created_at: "2026-11-06", escalations_pct: null },
    ];
    const out = dedupeComps(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("new");
    expect(out[0].mergedFrom).toEqual(["old"]);
    expect(out[0].building_sf).toBe(11998);
    expect(out[0].escalations_pct).toBe(3);
  });
  it("keeps different leases at the same address apart", () => {
    const rows = [
      { ...base, id: "a", date_commenced: "2023-03-01", rent: 6038, tenant_name: "Tenant A" },
      { ...base, id: "b", date_commenced: "2024-06-23", rent: 8000, tenant_name: "Tenant B" },
    ];
    expect(dedupeComps(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("keeps different suites apart even on the same day and rent", () => {
    const rows = [{ ...base, id: "s1", suite: "100" }, { ...base, id: "s2", suite: "200" }];
    expect(dedupeComps(rows)).toHaveLength(2);
  });
  it("preserves the incoming (nearest-first) order", () => {
    const rows = [{ ...base, id: "near", address: "1 A St", date_commenced: "2020-01-01" }, { ...base, id: "far", address: "9 Z St", date_commenced: "2021-01-01", building_sf: 5 }];
    expect(dedupeComps(rows).map((r) => r.id)).toEqual(["near", "far"]);
  });
});

describe("dedupeComps with partial detail", () => {
  const lease = { comp_type: "lease", address: "11217 Telephone Road", suite: null, latitude: 29.602, longitude: -95.2851, date_commenced: "2025-01-01", rent: 1.03, tenant_name: "Runtoo Trading", sale_price: null, closed_on: null, buyer: null };
  it("merges when only one copy names the project", () => {
    const out = dedupeComps<Record<string, any>>([{ ...lease, id: "a", project_name: "Constellation Telephone Road - Bldg A", building_sf: null }, { ...lease, id: "b", project_name: null, building_sf: 20898 }]);
    expect(out).toHaveLength(1);
    expect(out[0].project_name).toBe("Constellation Telephone Road - Bldg A");
    expect(out[0].building_sf).toBe(20898);
  });
  it("keeps two differently named buildings apart", () => {
    expect(dedupeComps([{ ...lease, id: "a", project_name: "Bldg A" }, { ...lease, id: "b", project_name: "Bldg B" }])).toHaveLength(2);
  });
});
