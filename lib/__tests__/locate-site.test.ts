// Address rewrites behind the Portfolio OM location retries, and the street
// comparison that rejected 80 N FM 3083 Rd East, Conroe (Google's route is
// "North Farm to Market 3083 Road East").

import { describe, expect, it } from "vitest";
import { streetKey } from "../geocode";
import { abbreviateDirections, roadOnly } from "../locate-site";

describe("streetKey", () => {
  it("treats Google's long route name as the OM's spelling", () => {
    expect(streetKey("N FM 3083 Rd East")).toBe(streetKey("North Farm to Market 3083 Road East"));
    expect(streetKey("N FM 3083 Rd. E.")).toBe(streetKey("N FM 3083 Rd E"));
  });
  it("still tells different streets apart", () => {
    expect(streetKey("N FM 3083 Rd E")).not.toBe(streetKey("FM 3083 Rd"));
    expect(streetKey("Hansen Rd")).not.toBe(streetKey("Sheldon Rd"));
  });
  it("keeps the old equivalences", () => {
    expect(streetKey("Highway 114")).toBe(streetKey("TX-114"));
    expect(streetKey("Bonnie View Dr")).toBe(streetKey("Bonnie View Rd"));
  });
});

describe("retry rewrites", () => {
  it("abbreviates direction words only", () => {
    expect(abbreviateDirections("80 North FM 3083 Rd East")).toBe("80 N FM 3083 Rd E");
    expect(abbreviateDirections("1200 Eastside Dr")).toBe("1200 Eastside Dr");
  });
  it("reduces an address to its road", () => {
    expect(roadOnly("80 N FM 3083 Rd East")).toBe("FM 3083");
    expect(roadOnly("10315 Sheldon Rd")).toBe("Sheldon");
    expect(roadOnly("1200 W. Little York Rd, Suite 4")).toBe("Little York");
  });
});
