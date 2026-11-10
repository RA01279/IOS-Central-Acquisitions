import { describe, expect, it } from "vitest";
import { aerialUrl, compsWithin, parseRadiusQuery, type RadiusComp } from "./radius";

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
