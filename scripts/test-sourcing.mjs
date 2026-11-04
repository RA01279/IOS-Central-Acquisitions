// Off-market sourcing: site grouping and Hopper de-duplication, the agent's
// report contract, the sweep route and the add-prospect route. Synthetic data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cache = new Map();
function load(path, deps = {}) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  const src = ts.transpileModule(readFileSync(new URL("../" + path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(src, { exports: module.exports, module, require: (n) => deps[n] ?? require(n), console, URL, URLSearchParams, AbortSignal, process, fetch: (...a) => globalThis.fetch(...a) });
  cache.set(path, module.exports);
  return module.exports;
}
const match = load("lib/comps/match.ts");
const yard = load("lib/sourcing/yard-users.ts");
const profiles = load("lib/sourcing/profiles.ts", { "./yard-users": yard });
const parcels = load("lib/sourcing/parcels.ts");
const identity = load("lib/sourcing/identity.ts");
const discovery = load("lib/sourcing/discovery.ts", { './yard-users': yard });
const sweep = load("lib/sourcing/sweep.ts", { "@/lib/comps/match": match, "./yard-users": yard, "./parcels": parcels , './identity': identity, './discovery': discovery });
const sourcing = load("lib/agents/sourcing.ts");
const markets = load("lib/sourcing/markets.ts");
const snapshot = load("lib/sourcing/snapshot.ts", { "./identity": identity });

// ---- grouping and de-duplication ----------------------------------------------
const center = { lat: 30, lng: -95 };
const place = (id, name, lat, lng, vicinity, extra = {}) => ({ place_id: id, name, vicinity, geometry: { location: { lat, lng } }, category: "Trucking & Towing", business_status: "OPERATIONAL", ...extra });
const places = [
  place("a", "Acme Trucking", 30.001, -95.001, "100 Yard Rd, Testville"),
  place("b", "Bravo Crane", 30.0012, -95.0012, "102 Yard Rd, Testville"),            // ~30 m away, different property
  place("c", "Charlie Brick", 30.02, -95.02, "500 Industrial Pkwy E, Testville"),
  place("d", "Delta Stone", 30.0215, -95.0205, "500 Industrial Pkwy E Ste 4, Testville"), // same street address, other suite
  place("e", "Echo Fence", 30.05, -95.05, "900 Fence Ln, Testville"),
  place("f", "ACME TRUCKING", 30.03, -95.03, "1 Other Rd, Testville"),                // another branch of a chain
  place("g", "Far Away Hauling", 31, -95, "Far"),                                      // outside radius
];
const sites = sweep.buildSites(center, 5, places, [{ kind: "deal", id: "d1", label: "900 Fence Ln (archived)", href: "/deals/d1", lat: 30.0505, lng: -95.0502 }]);
assert.equal(sites.length, 5, "adjacent different addresses and separate chain branches remain distinct");
assert.equal(sites[0].operators.length, 1, "proximity alone does not combine different properties");
assert.equal(JSON.stringify(sites[2].operators.map((o) => o.name)), JSON.stringify(["Charlie Brick", "Delta Stone"]), "same street address, different suite, is one site");
assert.equal(sites[4].known?.kind, "deal", "a deal of any stage marks the site as known");
assert(sites.some((s) => s.operators.some((o) => o.name === "ACME TRUCKING")), "separate chain locations survive");
assert(!sites.some((s) => s.address === "Far"), "radius is enforced");
assert.equal(JSON.stringify(sites.map((s) => s.ref)), JSON.stringify(["S1", "S2", "S3", "S4", "S5"]));
assert(markets.findSubmarket("hou-n") && !markets.findSubmarket("nope"));

// ---- parcels -------------------------------------------------------------------
const roll = (over = {}) => ({ OWNER_NAME: "MC CAULEY LUMBER CO", NAME_CARE: "Null", MAIL_ADDR: "626 ALDINE BENDER RD, , HOUSTON, TX 77060", SITUS_ADDR: "626 ALDINE BENDER RD , HOUSTON, TX 77060",
  "st_area(shape)": "20000", LEGAL_AREA: "Null", YEAR_BUILT: "1965", MKT_VALUE: "1500000", PROP_ID: "0410", COUNTY: "HARRIS", SOURCE: "HARRIS APPRAISAL DISTRICT", TAX_YEAR: "2026", DATE_ACQ: "46235", ...over });
const parcelFetch = (attrs) => async (url) => { assert.match(String(url), /StratMap|stratmap/i); return { ok: true, json: async () => ({ results: attrs ? [{ attributes: attrs }] : [] }) }; };
const p1 = await parcels.lookupParcel(30, -95, parcelFetch(roll()));
assert.equal(p1.owner, "MC CAULEY LUMBER CO");
assert.equal(p1.mailingAddress, "626 ALDINE BENDER RD, HOUSTON, TX 77060", "empty address parts collapse");
assert.equal(p1.ownerCareOf, null, "the layer's literal \"Null\" is null");
assert.equal(p1.acres, Math.round(((20000 * Math.cos(Math.PI / 6) ** 2) / 4046.8564224) * 100) / 100, "Web Mercator area corrected to ground acres");
assert(!("ownedSince" in p1) && !JSON.stringify(p1).includes("46235"), "DATE_ACQ (the data refresh date) is never used");
assert.match(p1.source, /HARRIS APPRAISAL DISTRICT/);
assert.equal(await parcels.lookupParcel(30, -95, parcelFetch(null)), null);
assert.equal(parcels.classifyOwner("ALDINE ISD"), "public");
assert.equal(parcels.classifyOwner("PROLOGIS TEXAS LLC"), "institutional");
assert.equal(parcels.classifyOwner("SMITH JOHN"), "private");
assert(parcels.likelyOwnerUser("WALDREP JIMMY W & MARTHA SUE", ["A Waldrep Company, Inc."]));
assert(!parcels.likelyOwnerUser("HOUSTON SUPPLY HOLDINGS LLC", ["Summit Supply Co"]), "generic words don't count");
// Two pins on one parcel are one site; owner-user flag set from the merged operators.
const merged = sweep.attachParcels(sites.slice(0, 2), [{ ...p1, propId: "X1", county: "HARRIS" }, { ...p1, propId: "X1", county: "HARRIS" }]);
assert.equal(merged.length, 1, "same parcel, one acquisition");
assert.equal(merged[0].operators.length, 2);
assert.equal(merged[0].ref, "S1");

// Places screening reuses the demand map's yard rules.
const fetched = [];
const fakeFetch = async (url) => { fetched.push(String(url)); return { json: async () => ({ status: "OK", results: [
  place("x", "Ace Self Storage", 30.001, -95.001, "1 A St"), place("y", "Real Yard Co", 30.002, -95.002, "2 B St"),
  place("z", "Closed Yard", 30.003, -95.003, "3 C St", { business_status: "CLOSED_PERMANENTLY" }),
] }) }; };
const swept = await sweep.searchYardUsers(center, 3, "k", fakeFetch);
assert.equal(swept.totalSearches, yard.DEFAULT_CATEGORIES.flatMap((c) => c.keywords).length);
assert(swept.places.every((p) => p.name === "Real Yard Co"), "self-storage and closed businesses are screened out");
assert(fetched[0].includes("radius=4828"), "radius in metres");

// ---- report contract -------------------------------------------------------------
const site = (ref, extra = {}) => ({ ref, parcelAddress: "100 Yard Rd", city: "Testville", county: "Harris", parcelId: "123", owner: "Acme Holdings LLC", ownerMailingAddress: "PO Box 1", ownerType: "owner-user",
  acres: 3.2, buildingSf: 12000, yearBuilt: 1985, ownedSince: "1998", occupant: "Acme Trucking", zoning: "No zoning (Houston)", outdoorStorage: "unverified",
  signals: ["Owner-user since 1998"], fit: "strong", fitReason: "3.2 AC, 8.6% coverage.", outreach: "Dear owner, ...", sources: ["https://hcad.org/ (accessed 2026-10-02)"], unverified: [], ...extra });
const good = { version: sourcing.SOURCING_VERSION, sites: [site("S1"), site("S2", { owner: null, parcelId: null, acres: null, sources: [] })] };
assert.equal(sourcing.parseSourcing(JSON.stringify(good)).sites.length, 2);
assert.equal(sourcing.parseSourcing(JSON.stringify(good), ["S1"]), null, "refs must be ones that were supplied");
assert.equal(sourcing.parseSourcing(JSON.stringify({ ...good, sites: [site("S1", { sources: [] })] })), null, "owner facts need a source");
assert.equal(sourcing.parseSourcing(JSON.stringify({ ...good, sites: [site("S1", { ownerType: "landlord" })] })), null, "enumerations are enforced");
assert.equal(sourcing.parseSourcing(JSON.stringify({ ...good, sites: Array.from({ length: 11 }, (_, i) => site("S" + (i + 1))) })), null, "at most 10 sites");
assert.match(sourcing.SOURCING_INSTRUCTIONS, /never sent automatically/);
assert.match(sourcing.SOURCING_INSTRUCTIONS, /must come from the appraisal district or deed records/);

// ---- routes ----------------------------------------------------------------------
const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };
let user = { email: "Owner@Example.com" };
const runFilters = [];
let runRow;
let previousDeal = null;
const reviewed = { version: 2, sweepId: "00000000-0000-4000-8000-000000000002", market: "Houston", searchLabel: "Test", buyBox: { minAcres: 2, maxAcres: 10, maxCoveragePct: 30 }, sites: [sites[0]] };
const sourceRows = [{ label: snapshot.SNAPSHOT_LABEL, data: reviewed }];
function strictReport(report) { for (const s of report.sites) { s.fieldSources = Object.fromEntries(Object.entries(s).filter(([k,v]) => ["parcelAddress","city","county","parcelId","owner","ownerMailingAddress","acres","buildingSf","yearBuilt","ownedSince","occupant","zoning"].includes(k) && v != null).map(([k]) => [k, "https://hcad.org/"])); if (s.ownerType === "owner-user") s.fieldSources.ownerRelationship = "https://hcad.org/"; } return report; }
runRow = { sources: sourceRows, result: { report: JSON.stringify(strictReport({ ...good, sites: [site("S1")] })) } };
const db = { from: (table) => {
  const b = { insert: () => b, single: async () => ({ data: { id: reviewed.sweepId }, error: null }), select: () => b, not: () => b, order: () => b, eq: (k, v) => { if (table === "agent_runs") runFilters.push([k, v]); return b; },
    range: async (from) => ({ data: from === 0 && table === "properties" ? [{ id: "p1", address: "100 Yard Rd", latitude: 30.001, longitude: -95.001, deals: [{ id: "d9", stage: "archived" }] }] : [], error: null }),
    maybeSingle: async () => ({ data: table === "deals" ? previousDeal : runFilters.some(([k, v]) => k === "owner_email" && v === "owner@example.com") ? runRow : null, error: null }) };
  return b;
} };
const auth = { getCurrentUser: async () => user };
process.env.GOOGLE_MAPS_SERVER_KEY = "k";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => ({ json: async () => ({ status: "OK", results: String(url).includes("trucking") ? [place("t1", "Acme Trucking", 30.0011, -95.0011, "100 Yard Rd, Testville")] : [] }) });
try {
  const sweepRoute = load("app/api/sourcing/sweep/route.ts", { "next/server": { NextResponse }, "@/lib/auth": auth, "@/lib/supabase": { getServiceClient: () => db },
    "@/lib/comps/mapData": load("lib/comps/mapData.ts"), "@/lib/geocode": { geocodeAddress: async () => null }, "@/lib/location": load("lib/location.ts"),
    "@/lib/sourcing/markets": markets, "@/lib/sourcing/profiles": profiles, "@/lib/sourcing/sweep": sweep, "@/lib/sourcing/parcels": parcels, "@/lib/comps/match": match,
    "@/lib/sourcing/usable-acres": load("lib/sourcing/usable-acres.ts", { "./usable-summary": load("lib/sourcing/usable-summary.ts"), "./site-raster": load("lib/sourcing/site-raster.ts") }) });
  const req = (body) => ({ json: async () => body });
  const r = await sweepRoute.POST(req({ lat: 30, lng: -95, radiusMiles: 3, profileIds: ["trucking-towing"] }));
  assert.equal(r.status, 200);
  assert.equal(r.body.sites.length, 1);
  assert.equal(r.body.sites[0].known?.href, "/deals/d9", "an archived deal at the site is flagged");
  assert.equal((await sweepRoute.POST(req({ lat: 30, lng: -95, radiusMiles: 50, profileIds: ["trucking-towing"] }))).status, 400, "radius capped");
  assert.equal((await sweepRoute.POST(req({ address: "nowhere", radiusMiles: 3, profileIds: ["trucking-towing"] }))).status, 400, "unresolvable address");
  for (const profileIds of [undefined, [], ["employee-id"], ["trucking-towing", "unknown"]]) assert.equal((await sweepRoute.POST(req({ lat: 30, lng: -95, radiusMiles: 3, profileIds }))).status, 400, "missing or unknown profiles never broaden search");

  const created = [], events = [];
  let dupe = false;
  const prospectRoute = load("app/api/sourcing/prospect/route.ts", { "next/server": { NextResponse }, "@/lib/auth": auth, "@/lib/supabase": { getServiceClient: () => db },
    "@/lib/deals": { createDeal: async (input) => { created.push(input); return dupe ? { duplicates: [{ id: "old" }] } : { deal: { id: "new-deal" } }; }, logDealEvent: async (...a) => { events.push(a); } },
    "@/lib/geocode": { geocodeAddress: async () => ({ lat: 30.0012, lng: -95.0013, precision: "rooftop", formatted: "100 Yard Rd" }) },
    "@/lib/location": load("lib/location.ts"), "@/lib/agents/catalog": { UUID: /^[0-9a-f-]{36}$/i }, "@/lib/agents/sourcing": sourcing,
    "@/lib/sourcing/parcels": { lookupParcel: async () => ({ ...p1, propId: "123", owner: "ROLL OWNER LLC", situsAddress: "100 YARD RD , TESTVILLE, TX" }) },
    "@/lib/markets": load("lib/markets.ts"), "@/lib/market-owners": { defaultOwner: async (_m, _c, creator) => creator }, "@/lib/sourcing/snapshot": snapshot, "@/lib/sourcing/identity": identity, "@/lib/comps/match": match });
  const runId = "00000000-0000-4000-8000-000000000001";
  const body = { runId, ref: "S1", market: "Atlanta", site: { lat: 1, lng: 1, address: "100 Yard Rd, Testville", operators: ["Acme Trucking"] } };
  const ok = await prospectRoute.POST(req(body));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.dealId, "new-deal");
  for (const want of [["owner_email", "owner@example.com"], ["agent", "off-market-sourcing"], ["status", "completed"], ["id", runId]]) assert(runFilters.some(([k, v]) => k === want[0] && v === want[1]), `run lookup filters on ${want[0]}`);
  const c = created[0];
  assert.equal(c.marketingStatus, "off_market");
  assert.equal(c.acquisitionType, "slb", "owner-user becomes a sale-leaseback prospect");
  assert.equal(c.currentOwnerName, "Acme Holdings LLC");
  assert.equal(c.geocodePrecision, "rooftop", "verified parcel address preferred over the business pin");
  assert.equal(c.acres, 3.2);
  assert.equal(c.market, "Houston", "browser market is ignored");
  previousDeal = { id: "new-deal" };
  assert.equal((await prospectRoute.POST(req(body))).body.dealId, "new-deal", "promotion retry returns the original deal");
  assert.equal(created.length, 1); previousDeal = null;
  assert.equal(events[0][1], "sourcing_research");
  assert(events[0][2].outreachDraft && events[0][2].sources.length, "research and outreach draft attached to the deal");
  // An agent that found no owner falls back to the appraisal roll, looked up server-side.
  runRow = { sources: sourceRows, result: { report: JSON.stringify(strictReport({ ...good, sites: [site("S1", { owner: null, parcelAddress: null, acres: null })] })) } };
  await prospectRoute.POST(req(body));
  assert.equal(created[1].currentOwnerName, "ROLL OWNER LLC");
  assert.equal(created[1].address, "100 YARD RD");
  assert.equal(events[1][2].appraisalRoll.owner, "ROLL OWNER LLC");
  runRow = { sources: sourceRows, result: { report: JSON.stringify(strictReport({ ...good, sites: [site("S1")] })) } };
  dupe = true;
  assert.equal((await prospectRoute.POST(req(body))).status, 409, "existing address is not duplicated");
  assert.equal((await prospectRoute.POST(req({ ...body, ref: "S7" }))).status, 404, "refs outside the report are refused");
  user = { email: "someone@else.com" }; runFilters.length = 0;
  assert.equal((await prospectRoute.POST(req(body))).status, 409, "another user's run can't be used");
  user = null;
  assert.equal((await sweepRoute.POST(req({ lat: 30, lng: -95, radiusMiles: 3, profileIds: ["trucking-towing"] }))).status, 401);
  assert.equal((await prospectRoute.POST(req(body))).status, 401);
} finally { globalThis.fetch = realFetch; }
console.log("PASS: appraisal-roll parcels (owner, Mercator acreage, DATE_ACQ ignored, public/institutional, owner-user), same-parcel merge, yard-site grouping (proximity, street address, chains, radius), Hopper de-dup incl. archived deals, Places screening, report contract (sources, refs, enums, limits), sweep and add-prospect routes (owner-scoped, SLB for owner-users, verified pin, research attached, duplicates refused).");
