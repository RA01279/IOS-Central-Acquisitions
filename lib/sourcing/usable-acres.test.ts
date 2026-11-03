import { describe, it, expect } from "vitest";
import { measureUsableAcres, ringsToGeom, STRUCTURES, NFHL_ZONES, NWI } from "./usable-acres";
import { usableSummary, type UsableAcres } from "./usable-summary";
import { assessSourcingFit } from "./fit";

// Esri outer rings run clockwise: [w,s] -> [w,n] -> [e,n] -> [e,s].
const box = (w: number, s: number, e: number, n: number) => [[w, s], [w, n], [e, n], [e, s], [w, s]];
const hole = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const parcel = [box(-95.002, 29.998, -95.0, 30.0)];

function fake(layers: Partial<Record<string, any[] | "fail">>): typeof fetch {
  return (async (url: any) => {
    const hit = Object.entries(layers).find(([k]) => String(url).startsWith(k));
    const v = hit?.[1] ?? [];
    if (v === "fail") return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ features: v }), { status: 200 });
  }) as typeof fetch;
}

describe("net usable acres from a parcel outline", () => {
  it("deducts buildings, floodplain and wetlands once each where they overlap", async () => {
    const u = (await measureUsableAcres(parcel, fake({
      // West quarter is a building; south half is in the floodplain (overlapping the building); a wetland sits in the flood strip and in the clear yard.
      [STRUCTURES]: [{ attributes: {}, geometry: { rings: [box(-95.002, 29.998, -95.0015, 30.0)] } }, { attributes: {}, geometry: { rings: [box(-94.99, 29.99, -94.989, 29.991)] } }],
      [NFHL_ZONES]: [{ attributes: { SFHA_TF: "T", FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY" }, geometry: { rings: [box(-95.003, 29.997, -94.999, 29.999)] } },
        { attributes: { SFHA_TF: "F", FLD_ZONE: "X" }, geometry: { rings: [box(-95.003, 29.999, -94.999, 30.001)] } }],
      [NWI]: [{ attributes: { WETLAND_TYPE: "Freshwater Emergent Wetland" }, geometry: { rings: [box(-95.0005, 29.9985, -95.0001, 29.9995)] } }],
    })))!;
    expect(u.grossAcres).toBeCloseTo(10.56, 1);
    expect(u.buildingsAcres).toBeCloseTo(u.grossAcres / 4, 1);
    // Flood covers half the parcel, less the quarter of that under the building.
    expect(u.floodAcres).toBeCloseTo(u.grossAcres * 3 / 8, 1);
    expect(u.wetlandsAcres).toBeCloseTo(u.grossAcres * (0.4 * 0.5) / 4, 1);
    expect(u.netAcres + u.buildingsAcres + u.floodAcres + u.wetlandsAcres).toBeCloseTo(u.grossAcres, 1);
    expect(u.coveragePct).toBeCloseTo(25, 0);
    expect(u.buildingCount).toBe(1);
    expect(u.floodZones).toEqual(["AE floodway"]);
    expect(u.wetlandTypes).toEqual(["Freshwater Emergent Wetland"]);
    expect(u.failed).toEqual([]);
  });

  it("treats a layer it could not read as not measured, so net is an upper bound", async () => {
    const u = (await measureUsableAcres(parcel, fake({ [NFHL_ZONES]: "fail" })))!;
    expect(u.failed).toEqual(["flood"]);
    expect(u.netAcres).toBeCloseTo(u.grossAcres, 2);
    expect(usableSummary(u)).toMatch(/flood not read, so net may be lower/);
  });

  it("subtracts holes in the parcel outline", () => {
    const g = ringsToGeom([box(-95.002, 29.998, -95.0, 30.0), hole(-95.0015, 29.9985, -95.0005, 29.9995)]);
    expect(g).toHaveLength(1);
    expect(g[0]).toHaveLength(2);
  });
});

describe("buy-box fit uses the measurement", () => {
  const base: any = { ref: "S1", ownerType: "private investor", outdoorStorage: "permitted", acres: 10, usableAcres: null, buildingFootprintSf: null };
  const bb = { minAcres: 1.5, maxAcres: 10, maxCoveragePct: 35 };
  const m = (o: Partial<UsableAcres>): UsableAcres => ({ grossAcres: 10, netAcres: 6, buildingsAcres: 1, floodAcres: 3, wetlandsAcres: 0, buildingCount: 1, coveragePct: 10, buildingFootprintSf: 43560, floodZones: [], wetlandTypes: [], failed: [], notChecked: ["easements"], measuredAt: "", ...o });
  it("rates a measured site strong without researched usable acres", () => {
    const r = assessSourcingFit(base, bb, m({}));
    expect(r.fit).toBe("strong");
    expect(r.fitReason).toMatch(/6 net usable acres measured.*easements not checked/);
  });
  it("rules out a site the floodplain shrinks below the minimum", () => {
    expect(assessSourcingFit(base, bb, m({ netAcres: 1.2, floodAcres: 7.8 })).fit).toBe("poor");
  });
  it("never rates an upper-bound measurement strong, nor rules it out as too large", () => {
    expect(assessSourcingFit(base, bb, m({ failed: ["flood"] })).fit).toBe("possible");
    expect(assessSourcingFit({ ...base, acres: 14 }, bb, m({ grossAcres: 14, netAcres: 12, failed: ["flood"] })).fit).toBe("possible");
  });
  it("uses measured coverage", () => {
    expect(assessSourcingFit(base, bb, m({ coveragePct: 48 })).fit).toBe("poor");
  });
});
