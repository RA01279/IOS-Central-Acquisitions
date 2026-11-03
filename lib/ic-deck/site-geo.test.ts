import { describe, it, expect } from "vitest";
import { highwayName, ringAcres, encodePolyline, highwayCaption } from "./site-geo";

describe("site exhibits", () => {
  it("writes TIGER highway names the way decks do", () => {
    expect(highwayName("State Hwy 249")).toBe("SH 249");
    expect(highwayName("State Hwy 92", "SR")).toBe("SR 92");
    expect(highwayName("US Hwy 290")).toBe("US 290");
    expect(highwayName("I- 45")).toBe("I-45");
    expect(highwayName("Ih 45-Hov Fwy")).toBe("I-45");
    expect(highwayName("State Loop 8")).toBe("Loop 8");
    expect(highwayName("Tomball Pkwy")).toBeNull();
  });
  it("measures a one-acre square to within half a percent", () => {
    const side = Math.sqrt(4046.8564224); // metres
    const dLat = side / 110540, dLng = side / (111320 * Math.cos(30 * Math.PI / 180));
    const acres = ringAcres([[30, -95], [30 + dLat, -95], [30 + dLat, -95 + dLng], [30, -95 + dLng]]);
    expect(Math.abs(acres - 1)).toBeLessThan(0.005);
  });
  it("encodes polylines in Google's format", () => {
    // Google's documented example.
    expect(encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });
  it("captions both highway measures", () => {
    const c = highwayCaption({ highway: "SH 249", toHighway: { miles: 1.16, minutes: 4, point: [0, 0], polyline: null }, toRamp: { miles: 3.1, minutes: 9, point: [0, 0], polyline: null, exit: null } });
    expect(c).toBe("SH 249: 1.2 miles | 4 minutes to the highway; 3.1 miles | 9 minutes to the nearest SH 249 on-ramp");
  });
});
