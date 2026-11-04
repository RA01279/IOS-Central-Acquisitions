import { describe, expect, it, vi } from "vitest";
vi.mock("./supabase", () => ({ getServiceClient: () => { throw new Error("no db in tests"); } }));
const { siteFromUsable } = await import("./site-signals");

const u = (o: Record<string, unknown> = {}) => ({ grossAcres: 10, netAcres: 8, buildingsAcres: 1, floodAcres: 0, wetlandsAcres: 0, steepAcres: 0, narrowAcres: 1,
  buildingCount: 1, coveragePct: 10, buildingFootprintSf: 43560, floodZones: [], wetlandTypes: [], failed: [], notChecked: ["easements"], measuredAt: "", ...o }) as any;

describe("site flag from net usable acres", () => {
  it("is strong when most of the parcel is usable and dry", () => {
    const a = siteFromUsable(u());
    expect(a.state).toBe("strong");
    expect(a.note).toMatch(/^8 of 10 ac usable \(buildings −1, narrow strips −1\)\. easements not checked\.$/);
    expect((a.detail as any).usable.netAcres).toBe(8);
  });
  it("watches a site with some floodplain, wetlands or steep ground", () => {
    expect(siteFromUsable(u({ floodAcres: 1.5, netAcres: 6.5 })).state).toBe("watch");
    expect(siteFromUsable(u({ wetlandsAcres: 0.2, netAcres: 7.8 })).state).toBe("watch");
    expect(siteFromUsable(u({ steepAcres: 1.2, netAcres: 6.8 })).state).toBe("watch");
  });
  it("watches when a layer could not be read", () => {
    expect(siteFromUsable(u({ failed: ["flood"] })).state).toBe("watch");
  });
  it("is weak when half is floodplain or under an acre is usable", () => {
    expect(siteFromUsable(u({ floodAcres: 5.5, netAcres: 2.5 })).state).toBe("weak");
    expect(siteFromUsable(u({ grossAcres: 1.2, netAcres: 0.8 })).state).toBe("weak");
  });
});
