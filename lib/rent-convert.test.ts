import { describe, expect, it } from "vitest";
import { parseRate, perAcreToPerSf, perSfToPerAcre, siteRent, SF_PER_ACRE, usd } from "./rent-convert";

describe("rent calculator", () => {
  it("converts per usable acre per month to per SF per month, to 8 decimals", () => {
    expect(SF_PER_ACRE).toBe(43560);
    expect(perAcreToPerSf(7500)).toBe("0.17217631");
    expect(perAcreToPerSf(43560)).toBe("1.00000000");
    expect(perAcreToPerSf(10000)).toBe("0.22956841");
    expect(perAcreToPerSf(0)).toBe("0.00000000");
  });
  it("converts back to per acre, to the cent", () => {
    expect(perSfToPerAcre(0.17217631)).toBe("7,500.00");
    expect(perSfToPerAcre(1)).toBe("43,560.00");
  });
  it("reads typed amounts with $ and commas, and rejects junk", () => {
    expect(parseRate("$7,500")).toBe(7500);
    expect(parseRate(" 0.17 ")).toBe(0.17);
    expect(parseRate(".5")).toBe(0.5);
    for (const bad of ["", ".", "abc", "-5", "1.2.3", "7,5x0"]) expect(parseRate(bad)).toBeNull();
  });
});

describe("site rent", () => {
  it("prices a 5-acre site at $7,000 per usable acre per month", () => {
    const r = siteRent(7000, 5)!;
    expect(r.monthly).toBe(35000);
    expect(r.annual).toBe(420000);
    expect(r.usableSf).toBe(217800);
    expect(perAcreToPerSf(7000)).toBe("0.16069789");
    expect(r.perSfAnnual).toBe("1.92837466");
    expect(usd(r.monthly)).toBe("$35,000.00");
    expect(usd(r.annual)).toBe("$420,000.00");
  });
  it("handles fractional acres and waits for both numbers", () => {
    expect(siteRent(7500, 4.68)!.monthly).toBeCloseTo(35100, 6);
    expect(siteRent(7000, null)).toBeNull();
    expect(siteRent(null, 5)).toBeNull();
    expect(siteRent(7000, 0)).toBeNull();
  });
});
