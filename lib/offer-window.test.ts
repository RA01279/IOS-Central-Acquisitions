import { describe, expect, it } from "vitest";
import { offerWindow, windowBuckets } from "./offer-window";

const today = "2026-11-10";

describe("offerWindow", () => {
  it("defaults to year to date", () => {
    expect(offerWindow({}, today)).toMatchObject({ range: "ytd", start: "2026-01-01", end: today });
  });
  it("uses a preset", () => {
    expect(offerWindow({ range: "mtd" }, today)).toMatchObject({ range: "mtd", start: "2026-11-01", end: today });
  });
  it("uses custom dates over a preset, and fills a missing end with today", () => {
    expect(offerWindow({ range: "ytd", from: "2025-03-01", to: "2025-06-30" }, today)).toMatchObject({ range: "custom", start: "2025-03-01", end: "2025-06-30" });
    expect(offerWindow({ from: "2026-10-01" }, today)).toMatchObject({ range: "custom", start: "2026-10-01", end: today });
  });
  it("swaps dates entered backwards and ignores junk", () => {
    expect(offerWindow({ from: "2026-06-30", to: "2026-03-01" }, today)).toMatchObject({ start: "2026-03-01", end: "2026-06-30" });
    expect(offerWindow({ from: "06/30/2026" }, today).range).toBe("ytd");
  });
});

describe("windowBuckets", () => {
  it("goes by day up to two weeks", () => {
    const b = windowBuckets({ start: "2026-11-01", end: "2026-11-10" });
    expect(b.unit).toBe("day");
    expect(b.buckets).toHaveLength(10);
  });
  it("goes by week up to about four months, clipping the last week to the window", () => {
    const b = windowBuckets({ start: "2026-09-01", end: "2026-11-10" });
    expect(b.unit).toBe("week");
    expect(b.buckets.at(-1)!.to).toBe("2026-11-10");
  });
  it("goes by month beyond that, across years, clipped at both ends", () => {
    const b = windowBuckets({ start: "2025-09-15", end: "2026-02-10" });
    expect(b.unit).toBe("month");
    expect(b.buckets.map((x) => x.key)).toEqual(["2025-09-01", "2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(b.buckets[0].from).toBe("2025-09-15");
    expect(b.buckets.at(-1)!.to).toBe("2026-02-10");
    expect(b.buckets[0].label).toMatch(/25/);
  });
});
