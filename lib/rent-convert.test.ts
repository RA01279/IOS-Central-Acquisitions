import { describe, expect, it } from "vitest";
import { parseRate, perAcreToPerSf, perSfToPerAcre, SF_PER_ACRE } from "./rent-convert";

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
