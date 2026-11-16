// The sweep screen, on the Grand Prairie parcels that prompted it (Tarrant and
// Dallas appraisal rolls, Nov 2026).
import { describe, it, expect } from "vitest";
import { assessHolding, individualOwner, ownerOccupied, streetKey, lookupNeighbours, type Neighbour } from "./holding";
import { screenSite } from "./screen";
import type { Parcel } from "./parcels";

const box = { minAcres: 1.5 };
const parcel = (p: Partial<Parcel>): Parcel => ({ owner: null, ownerCareOf: null, mailingAddress: null, situsAddress: null, acres: null, legalArea: null, yearBuilt: null, marketValue: null, propId: null, county: "TARRANT", source: "TxGIO StratMap Land Parcels (county appraisal district roll): TARRANT APPRAISAL DISTRICT", taxYear: 2026, ownerClass: "private", ...p });
const n = (propId: string, owner: string, situs: string, mailing: string, acres: number | null): Neighbour => ({ propId, owners: [owner], mailing: [mailing], situs, acres, outline: null });

const ravenwood = parcel({ owner: "VELASQUEZ BARBARA", mailingAddress: "2230 RAVENWOOD DR, GRAND PRAIRIE, TX 75050", situsAddress: "2230 RAVENWOOD DR", acres: 0.19, yearBuilt: 1967, propId: "38420-1-19" });
const ravenwoodStreet = [
  n("38420-1-18", "SIDERIS DOROTHY C", "2302 RAVENWOOD DR", "2302 RAVENWOOD DR, GRAND PRAIRIE, TX 75050", 0.26),
  n("30953-A-1-10", "KEVIN & BRANDI WILLETT", "2241 VEGA ST", "2241 VEGA ST, GRAND PRAIRIE, TX 75050", null),
  n("46783-5-3-10", "WHITLOW DONALD", "2237 VEGA ST", "2237 VEGA ST, GRAND PRAIRIE, TX 75050", 0.21),
  n("38420-1-20", "TOWNSEND CYNTHIA LOU", "2226 RAVENWOOD DR", "2226 RAVENWOOD DR, GRAND PRAIRIE, TX 75050", 0.24),
  n("38420-1-19", "VELASQUEZ BARBARA", "2230 RAVENWOOD DR", "2230 RAVENWOOD DR, GRAND PRAIRIE, TX 75050", 0.2),
];

describe("owner and address signals", () => {
  it("tells people from companies", () => {
    for (const o of ["VELASQUEZ BARBARA", "KEVIN & BRANDI WILLETT", "SMITH FAMILY LIVING TRUST"]) expect(individualOwner(o)).toBe(true);
    for (const o of ["GRAND PRAIRIE FEED &", "LANE SUPPLY CO INC", "BILEK FAMILY TRUST AND JLBK LIVING TRUST AND CO", "SL6 LOGISTICS LP", "PHOENIX CORPORATION", "UNITED RENTALS REALTY LLC", "MID-SOUTH LUMBER COMPANY OF GEORGIA INC"]) expect(individualOwner(o)).toBe(false);
  });
  it("matches a roll's mailing and situs streets despite suffix and direction noise", () => {
    expect(streetKey("1304 E PACIFIC ST , GRAND PRAIRIE, TEXAS")).toBe(streetKey("1304 E PACIFIC AVE ,GRAND PRAIRIE (DALLAS CO), TX"));
    expect(ownerOccupied(ravenwood)).toBe(true);
    expect(ownerOccupied({ mailingAddress: "673 FALCON CLIFF CT, HENDERSON, NV", situsAddress: "1795 109TH ST" })).toBe(false);
  });
});

describe("holding", () => {
  it("adds the owner's adjoining parcels: 1795 109th St is 3.7 acres, not 0.85", () => {
    const p = parcel({ owner: "BILEK FAMILY TRUST AND JLBK LIVING TRUST", mailingAddress: "673 FALCON CLIFF CT, HENDERSON, NV 89012", situsAddress: "1795 109TH ST", acres: 0.85, propId: "48515-1-4A" });
    const h = assessHolding(p, [
      n("48515-1-5", "BILEK FAMILY TRUST AND JLBK LIVING TRUST", "1713 109TH ST", "673 FALCON CLIFF CT, HENDERSON, NV 89012", 2.87),
      { ...n("48515-1-4A", "BILEK FAMILY TRUST AND JLBK LIVING TRUST", "1795 109TH ST", "673 FALCON CLIFF CT, HENDERSON, NV 89012", 0.85), owners: ["BILEK FAMILY TRUST AND JLBK LIVING TRUST", "QUIKRETE HOLDINGS INC"] },
      n("48515-1-4-10", "HPCHJM LLC", "1801 109TH ST", "2461 N STEMMONS FRWY, DALLAS, TX 75207", 0.45),
    ], true);
    expect(h.acres).toBe(3.72);
    expect(h.parcels.map((x) => x.propId)).toEqual(["48515-1-4A", "48515-1-5"]);
    expect(screenSite({ parcel: p, holding: h, identityStatus: "parcel-matched" }, box)).toEqual([]);
  });
  it("joins a truncated owner name: Grand Prairie Feed is two parcels, still under the box", () => {
    const p = parcel({ owner: "GRAND PRAIRIE FEED &", mailingAddress: "4348 GREENWOOD RD , WEATHERFORD, TEXAS", situsAddress: "1229 E MAIN ST ,GRAND PRAIRIE (DALLAS CO), TX", acres: 0.42, propId: "28101500100000600", county: "DALLAS" });
    const h = assessHolding(p, [
      n("28101500100000500", "GRAND PRAIRIE FEED & GARDEN", "1225 E MAIN ST", "4348 GREENWOOD RD , WEATHERFORD, TEXAS", 0.57),
      n("28101500100000700", "CAMARENA AUTO INC", "1310 E PACIFIC AVE", "1305 E MAIN ST , GRAND PRAIRIE, TEXAS", 0.88),
      n("281015000010R0000", "PHAM TIEM VAN", "1304 E PACIFIC AVE", "1304 E PACIFIC ST , GRAND PRAIRIE, TEXAS", 0.45),
    ], true);
    expect(h.acres).toBe(0.99);
    const flags = screenSite({ parcel: p, holding: h, identityStatus: "parcel-matched" }, box);
    expect(flags.map((f) => f.code)).toEqual(["small"]);
    expect(flags[0].detail).toContain("2 adjoining parcels total 0.99 acres");
  });
  it("never joins neighbours who each live at their own house", () => {
    expect(assessHolding(ravenwood, ravenwoodStreet, true).parcels).toHaveLength(1);
  });
});

describe("screen", () => {
  it("flags 2230 Ravenwood Dr as a house, with the evidence", () => {
    const h = assessHolding(ravenwood, ravenwoodStreet, true);
    expect(h).toMatchObject({ neighbours: 4, houseLots: 3, businessLots: 0 });
    const flags = screenSite({ parcel: ravenwood, holding: h, identityStatus: "parcel-matched" }, box);
    expect(flags.map((f) => f.code)).toEqual(["house", "small"]);
    expect(flags[0].detail).toContain("owned by VELASQUEZ BARBARA; who gets tax mail there");
    expect(flags[0].detail).toContain("3 of 4 neighbouring lots are house-sized, none carries a business");
  });
  it("flags a house from the parcel alone in sweeps saved before holdings", () => {
    expect(screenSite({ parcel: ravenwood, identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["house", "small"]);
  });
  it("does not call an owner-occupied business yard a house", () => {
    const lane = parcel({ owner: "LANE SUPPLY CO INC", mailingAddress: "120 FAIRVIEW ST, ARLINGTON, TX 76010", situsAddress: "120 FAIRVIEW ST", acres: 6.62 });
    expect(screenSite({ parcel: lane, identityStatus: "parcel-matched" }, box)).toEqual([]);
    const smallYard = parcel({ owner: "MARSHAL RENEE CONSTRUCTION", mailingAddress: "1177 LAUSANNE AVE, DALLAS", situsAddress: "514 BONHAM ST", acres: 0.35 });
    expect(screenSite({ parcel: smallYard, identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["small"]);
  });
  it("concludes nothing without a trustworthy parcel", () => {
    expect(screenSite({ parcel: null, identityStatus: "unverified" }, box)).toEqual([]);
    expect(screenSite({ parcel: ravenwood, identityStatus: "address-conflict" }, box)).toEqual([]);
  });
  it("does not call a person's business yard a house: 2427 NW Dallas St, between a pump service and a sealant company", () => {
    const hawk = parcel({ owner: "ESPINOSA SANTOS", mailingAddress: "2427 NW DALLAS ST, GRAND PRAIRIE, TX 75050", situsAddress: "2427 NW DALLAS ST", acres: 0.46, yearBuilt: 1986, propId: "H" });
    const h = assessHolding(hawk, [
      { ...n("P", "C & P PUMP SERVICES INC", "2417 NW DALLAS ST", "2417 NW DALLAS ST, GRAND PRAIRIE, TX 75050", 0.46), owners: ["C & P PUMP SERVICES INC", "2417 NW DALLAS ST LLC"] },
      { ...n("S", "SEALANT SOLUTION INC", "2449 NW DALLAS ST", "1079 W ROUND GROVE RD STE 300-246, LEWISVILLE, TX", 0.61), owners: ["SEALANT SOLUTION INC", "SEALANT HOLDINGS LLC"] },
      n("Q", "2417 NW DALLAS ST LLC", "2420 HOUSTON ST", "2417 NW DALLAS ST, GRAND PRAIRIE, TX 75050", 0.61),
      { ...n("D", "DUNN MICHAEL G", "2436 HOUSTON ST", "2436 HOUSTON ST, GRAND PRAIRIE, TX 75050", 0.45), owners: ["DUNN MICHAEL G", "DUNN FOOD EQUIPMENT INC"] },
    ], true);
    expect(h).toMatchObject({ businessLots: 4, houseLots: 0 });
    expect(screenSite({ parcel: hawk, holding: h, identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["small"]);
    // Without neighbours, 0.46 acres is too big to call a house from the owner's mailing address alone.
    expect(screenSite({ parcel: hawk, identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["small"]);
  });
  it("calls a person's lot among house lots a house even when the neighbours rent", () => {
    const jonathan = parcel({ owner: "QUINTANAR-OLVERA CEFERINO AND LEIJA VERONICA", mailingAddress: "704 JONATHAN LN, ARLINGTON, TX 76010", situsAddress: "704 JONATHAN LN", acres: 0.22, propId: "J" });
    const h = assessHolding(jonathan, [
      n("A", "JOSE M & JOSE PEREZ AGUIERE", "2015 SIDNEY ST", "1615 TOWER DR, ARLINGTON, TX 76010", 0.18),
      n("B", "CHRYSALIS D REAL ESTATE INVESTMENTS LLC", "702 JONATHAN LN", "145 HILLSIDE LN, DESOTO, TX 75115", 0.17),
    ], true);
    expect(screenSite({ parcel: jonathan, holding: h, identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["house", "small"]);
  });
  it("draws no neighbourhood conclusion from an incomplete lookup, and none for a company owner", () => {
    const company = parcel({ owner: "ACME FENCE LLC", mailingAddress: "PO BOX 1, DALLAS", situsAddress: "2230 RAVENWOOD DR", acres: 0.19 });
    const h = assessHolding(company, ravenwoodStreet, true);
    expect(screenSite({ parcel: company, holding: h, identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["small"]);
    const absentee = parcel({ owner: "SMITH JOHN", mailingAddress: "PO BOX 1, DALLAS", situsAddress: "2230 RAVENWOOD DR", acres: 0.19, propId: "38420-1-19" });
    expect(screenSite({ parcel: absentee, holding: assessHolding(absentee, ravenwoodStreet, false), identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["small"]);
    expect(screenSite({ parcel: absentee, holding: assessHolding(absentee, ravenwoodStreet, true), identityStatus: "parcel-matched" }, box).map((f) => f.code)).toEqual(["house", "small"]);
  });
});

describe("lookupNeighbours", () => {
  it("groups tenant accounts by parcel and marks a capped identify incomplete", async () => {
    const results = Array.from({ length: 20 }, (_, i) => ({ attributes: { PROP_ID: i < 18 ? "48527-3-1" : `X${i}`, OWNER_NAME: `TENANT ${i}`, MAIL_ADDR: "1 MAIN ST", SITUS_ADDR: "1201 W CARRIER PKWY", LEGAL_AREA: "14.53" } }));
    const fetcher = (async () => ({ ok: true, json: async () => ({ results }) })) as unknown as typeof fetch;
    const hit = await lookupNeighbours(parcel({ propId: "48527-3-1", outline: [[[-97, 32], [-97, 32.001], [-96.999, 32.001], [-97, 32]]] }), fetcher);
    expect(hit!.complete).toBe(false);
    expect(hit!.found).toHaveLength(3);
    expect(hit!.found[0].owners).toHaveLength(18);
  });
});
