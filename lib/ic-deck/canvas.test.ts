import { describe, it, expect } from "vitest";
import { submarketFromPoints, summarize, breakdown, canvasMapView, projectToView, radiusRing, type CanvasRecord } from "./canvas";

const rec = (acres: number | null, occupiedAcres: number | null, tenantUse: string | null, owner: string | null = "User"): CanvasRecord =>
  ({ acres, occupiedAcres, occupancy: "Leased", tenantUse, owner });

describe("market canvas", () => {
  it("computes the Golden Spike table columns: acreage vacancy, mean and sample std. dev.", () => {
    const list = [rec(10, 10, "Auto Storage"), rec(4, 2, "Auto Storage"), rec(1, 1, "Auto Storage")];
    const r = summarize("Auto Storage", list, 30);
    expect(r.count).toBe(3);
    expect(r.acres).toBe(15);
    expect(r.share).toBeCloseTo(0.5);
    expect(r.occupiedAcres).toBe(13);
    expect(r.vacancy).toBeCloseTo(2 / 15);
    expect(r.mean).toBe(5);
    expect(r.stdev).toBeCloseTo(Math.sqrt(((10 - 5) ** 2 + (4 - 5) ** 2 + (1 - 5) ** 2) / 2));
  });

  it("leaves unknown occupied acreage out of vacancy, and a single property has no std. dev.", () => {
    const r = summarize("x", [rec(8, null, "a"), rec(2, 1, "a")], 10);
    expect(r.vacancy).toBeCloseTo(0.5);
    expect(summarize("y", [rec(3, 3, "a")], 3).stdev).toBeNull();
    expect(summarize("z", [rec(3, null, "a")], 3).vacancy).toBeNull();
  });

  it("caps occupied acreage at the site's acreage and treats zero/blank acreage as 0", () => {
    const r = summarize("x", [rec(2, 5, "a"), rec(null, null, "a"), rec(0, 0, "a")], 2);
    expect(r.occupiedAcres).toBe(2);
    expect(r.acres).toBe(2);
    expect(r.mean).toBeCloseTo(2 / 3);
  });

  it("orders categories by count with blanks folded into Other, last", () => {
    const rows = breakdown([rec(1, 1, "B"), rec(1, 1, null), rec(1, 1, "A"), rec(1, 1, "A"), rec(1, 1, "Other")], "tenantUse", 5);
    expect(rows.map((r) => [r.label, r.count])).toEqual([["A", 2], ["B", 1], ["Other", 2]]);
  });

  it("frames the radius ring and projects points onto the map view", () => {
    const site = { lat: 29.92, lng: -95.53 };
    const v = canvasMapView(site, 5, 640, 451);
    expect(v.zoom).toBe(12);
    expect(projectToView(v, site.lat, site.lng)).toEqual([0.5, 0.5]);
    const [ex, ey] = projectToView(v, site.lat, site.lng + 0.05);
    expect(ex).toBeGreaterThan(0.5);
    expect(ey).toBeCloseTo(0.5, 6);
    const [, ny] = projectToView(v, site.lat + 0.05, site.lng);
    expect(ny).toBeLessThan(0.5);
    // The 5-mile ring's top and bottom sit near the frame's edges (allowed ~5% past).
    const ys = radiusRing(site.lat, site.lng, 5).map(([la, ln]) => projectToView(v, la, ln)[1]);
    expect(Math.min(...ys)).toBeGreaterThan(-0.1);
    expect(Math.max(...ys)).toBeLessThan(1.1);
  });
});

describe("submarket of a pin", () => {
  const pt = (lat: number, lng: number, submarket: string | null) => ({ lat, lng, submarket });
  it("takes the most common label among the nearest five", () => {
    const pts = [pt(30.001, -95, "North Corridor"), pt(30.002, -95, "Northwest"), pt(30.003, -95, "North Corridor"), pt(30.004, -95, "North Corridor"), pt(30.005, -95, "Northwest"), pt(30.1, -95, "Northwest"), pt(30.11, -95, "Northwest")];
    expect(submarketFromPoints(30, -95, pts)).toBe("North Corridor");
  });
  it("breaks a tie toward the nearest", () => {
    expect(submarketFromPoints(30, -95, [pt(30.002, -95, "B"), pt(30.001, -95, "A")])).toBe("A");
  });
  it("ignores unlabelled and unplaced points", () => {
    expect(submarketFromPoints(30, -95, [pt(30.0001, -95, null), { lat: null, lng: null, submarket: "X" }, pt(30.01, -95, " Y ")])).toBe("Y");
    expect(submarketFromPoints(30, -95, [])).toBeNull();
  });
});
