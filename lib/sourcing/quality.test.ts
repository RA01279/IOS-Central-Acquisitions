import { describe, it, expect } from "vitest";
import { discoverYardUsers } from "./discovery";
import { buildSites, matchKnownSites, type Site, type KnownPoint } from "./sweep";
import { blocksSourcing } from "./identity";
import { likelyOwnerUser } from "./parcels";
import { selectReviewedSites } from "./snapshot";
import { parseSourcing, type SourcedSite } from "../agents/sourcing";
import { assessSourcingFit } from "./fit";
const center = { lat: 33.6, lng: -84.4 };
const profiles = [{ id: "truck", label: "Trucking & Towing", keywords: ["trucking company"] }];
const place = (id: string, address = "323 Cash Memorial Blvd") => ({ place_id: id, name: "Yard Trucking", vicinity: address, geometry: { location: center }, category: profiles[0].label });
const fetcher = (fn: (url: URL) => any) => (async (u: any) => ({ json: async () => fn(new URL(u)) })) as typeof fetch;
const parcel = (id: string) => ({ county: "Clayton", propId: id } as any);
describe("bounded discovery", () => {
 it("follows tokens, retries warming tokens, preserves provenance and radius filtering", async () => {
  let tries = 0;
  const result = await discoverYardUsers(center, 3, "test", fetcher(u => {
   if (!u.searchParams.has("pagetoken")) return { status: "OK", results: [place("one")], next_page_token: "two" };
   if (!tries++) return { status: "INVALID_REQUEST" };
   return { status: "OK", results: [place("one"), { ...place("two", "325 Cash Memorial Blvd"), name: "Second Trucking" }, { ...place("outside"), geometry: { location: { lat: 35, lng: -84 } } }] };
  }), profiles, { wait: async () => {}, tile: false });
  expect(result.coverage.requests).toBe(3);
  expect(result.searches[0].pages).toBe(2);
  expect(buildSites(center, 3, result.places, []).flatMap(s => s.operators.map(o => o.placeId))).toEqual(["one", "two"]);
  expect(result.places[0].profileIds).toEqual(["truck"]);
 });
 it("enforces shared request budget and reports incomplete searches", async () => {
  const result = await discoverYardUsers(center, 3, "test", fetcher(() => ({ status: "OK", results: [place("one")], next_page_token: "two" })), profiles, { budget: 1, wait: async () => {} });
  expect(result.coverage.requests).toBe(1);
  expect(result.coverage.partial).toBe(true);
  expect(result.coverage.budgetExhausted).toBe(true);
 });
 it("subdivides saturated areas without treating a failed tile as a failed root", async () => {
  let n = 0;
  const result = await discoverYardUsers(center, 3, "test", fetcher(() => ++n <= 3 ? { status: "OK", results: Array.from({ length: 20 }, (_, i) => place(`${n}-${i}`)), next_page_token: n < 3 ? String(n) : undefined } : { status: "REQUEST_DENIED" }), profiles, { budget: 7, wait: async () => {} });
  expect(result.coverage.requests).toBe(7);
  expect(result.searches[0].cells).toBe(5);
  expect(result.failedSearches).toBe(0);
  expect(result.coverage.partial).toBe(true);
 });
});
describe("property evidence", () => {
 const base = { ...buildSites(center, 3, [place("one")], [])[0], parcel: parcel("13078D B008") };
 const known: KnownPoint = { kind: "comp", id: "comp", label: "317 Cash Memorial", address: "317 Cash Memorial Blvd", href: "/comps/comp", lat: center.lat + .0007, lng: center.lng, parcel: parcel("13078D B012") };
 it("keeps the audited adjacent Cash Memorial parcels separate", () => {
  const site = matchKnownSites([base], [known])[0];
  expect(site.known).toBeNull(); expect(site.nearby?.[0].match).toBe("nearby");
  expect(selectReviewedSites([site], [site.ref])).toHaveLength(1);
 });
 it("only blocks matching active deals and owned assets", () => {
  const same = { ...known, address: base.address, parcel: base.parcel };
  for (const k of [same, { ...same, kind: "deal", stage: "archived" }, { ...same, kind: "asset", status: "sold" }] as KnownPoint[]) expect(blocksSourcing(matchKnownSites([base], [k])[0])).toBe(false);
  for (const k of [{ ...same, kind: "deal", stage: "prospect" }, { ...same, kind: "asset", status: "owned" }] as KnownPoint[]) expect(selectReviewedSites(matchKnownSites([base], [k]), ["S1"])).toBeNull();
  expect(selectReviewedSites([base], ["S1", "S1"])).toBeNull();
  expect(selectReviewedSites([base], ["S9"])).toBeNull();
 });
 it("never infers an owner-user from the Georgia public owner name", () => {
  expect(likelyOwnerUser("STATE OF GEORGIA DEPARTMENT OF AGRICULTURE", ["Georgia Transport Compliance"])).toBe(false);
 });
});
describe("qualification evidence and fit", () => {
 const url = "https://county.example/parcel/123";
 const base: SourcedSite = { ref: "S1", parcelAddress: null, city: null, county: null, parcelId: null, owner: null, ownerMailingAddress: null, ownerType: "unknown", acres: null, buildingSf: null, yearBuilt: null, ownedSince: null, occupant: null, zoning: null, outdoorStorage: "unverified", signals: [], fit: "strong", fitReason: "", outreach: "", sources: [], unverified: [], fieldSources: {} };
 const parse = (sites: SourcedSite[], refs = ["S1"]) => parseSourcing(JSON.stringify({ version: "sourcing-v1", sites }), refs, true);
 it("requires exact unique references and linked dated evidence for every fact", () => {
  expect(parse([base])).not.toBeNull();
  expect(parse([])).toBeNull(); expect(parse([base, base])).toBeNull(); expect(parse([base], ["S1", "S2"])).toBeNull();
  expect(parse([{ ...base, owner: "Owner LLC", sources: ["County records"] }])).toBeNull();
  expect(parse([{ ...base, owner: "Owner LLC", sources: [`${url} accessed 2026-10-29`] }])).toBeNull();
  expect(parse([{ ...base, owner: "Owner LLC", sources: [`${url} accessed 2026-10-29`], fieldSources: { owner: url } }])).not.toBeNull();
  expect(parse([{ ...base, ownerType: "owner-user" }])).toBeNull();
 });
 it("does not use gross acres or floor area to claim strong fit", () => {
  const box = { minAcres: 2, maxAcres: 10, maxCoveragePct: 20 };
  expect(assessSourcingFit({ ...base, acres: 5, buildingSf: 10000, outdoorStorage: "permitted" }, box).fit).toBe("unknown");
  expect(assessSourcingFit({ ...base, acres: 5, usableAcres: 3, buildingFootprintSf: 10000, outdoorStorage: "permitted" }, box).fit).toBe("strong");
  expect(assessSourcingFit({ ...base, acres: 5, usableAcres: 3, buildingFootprintSf: 10000, ownerType: "public" }, box).fit).toBe("poor");
 });
});
