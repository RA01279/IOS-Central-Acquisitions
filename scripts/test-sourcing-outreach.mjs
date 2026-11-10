// scripts/test-sourcing-outreach.mjs
//
// Tests app/api/sourcing/outreach: sending sites straight from a saved sweep
// to the Outreach stage. Owner-scoped sweep lookup, appraisal-roll owner and
// address, the move to Outreach (off the pipeline), the evidence on the deal,
// one deal per site (retry returns it), and refusals for sites already in
// Hopper or with an address conflict.
//   node scripts/test-sourcing-outreach.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, deps = {}) {
  const module = { exports: {} };
  const src = ts.transpileModule(readFileSync(new URL("../" + path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(src, { exports: module.exports, module, require: (n) => deps[n] ?? require(n), console, URL, process });
  return module.exports;
}

const SWEEP = "00000000-0000-4000-8000-000000000009";
const parcel = { owner: "ACME HOLDINGS LLC", ownerCareOf: null, mailingAddress: "PO BOX 1, HOUSTON TX", situsAddress: "100 YARD RD , TESTVILLE, TX", acres: 4.1, legalArea: null, yearBuilt: 1998, marketValue: 900000, propId: "123", county: "Harris", source: "hcad", taxYear: 2026, ownerClass: "private" };
const site = (ref, extra = {}) => ({ ref, lat: 29.9, lng: -95.4, address: "100 Yard Rd, Testville, TX 77001", distanceMi: 1, operators: [{ placeId: "p", name: "Acme Trucking", category: "trucking", phone: "713-555-0100" }], categories: [], known: null, parcel, ownerUser: true, usable: { netAcres: 3.2, grossAcres: 4.1 }, identityStatus: "parcel-matched", ...extra });
const snapshot = { market: "Houston", sites: [site("S1"), site("S2", { known: { kind: "deal", stage: "uw", match: "same_property", relation: "active-deal" } }), site("S3", { identityStatus: "address-conflict" })] };

let user = { email: "Owner@Example.com" };
const filters = [], updates = [], events = [], created = [];
let existing = null;
const db = { from: (table) => {
  const b = {
    select: () => b, update: (v) => { updates.push([table, v]); return b; },
    eq: (k, v) => { filters.push([table, k, v]); return b; },
    maybeSingle: async () => table === "sourcing_sweeps"
      ? { data: filters.some(([t, k, v]) => t === "sourcing_sweeps" && k === "owner_email" && v === "owner@example.com") ? { id: SWEEP, snapshot } : null, error: null }
      : { data: existing, error: null },
    then: (resolve) => resolve({ error: null }),
  };
  return b;
} };
const route = load("app/api/sourcing/outreach/route.ts", {
  "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
  "@/lib/auth": { getCurrentUser: async () => user },
  "@/lib/supabase": { getServiceClient: () => db },
  "@/lib/deals": { createDeal: async (input) => { created.push(input); return { deal: { id: `deal-${created.length}` } }; }, logDealEvent: async (...a) => { events.push(a); } },
  "@/lib/agents/catalog": { UUID: /^[0-9a-f-]{36}$/i },
  "@/lib/markets": { canonicalMarket: (m) => m ?? null },
  "@/lib/market-owners": { defaultOwner: async (_m, _c, creator) => creator },
  "@/lib/sourcing/identity": load("lib/sourcing/identity.ts"),
});
const post = (body) => route.POST({ json: async () => body });

// One good site, one already active in Hopper, one with an address conflict.
const r = await post({ sweepId: SWEEP, refs: ["S1", "S2", "S3", "S1"] });
assert.equal(r.status, 200);
assert.equal(r.body.results.length, 3, "refs are de-duplicated");
assert.equal(r.body.results.find((x) => x.ref === "S1").dealId, "deal-1");
assert.match(r.body.results.find((x) => x.ref === "S2").error, /Already active/);
assert.match(r.body.results.find((x) => x.ref === "S3").error, /disagree/);
assert.equal(created.length, 1, "only the eligible site becomes a deal");
const c = created[0];
assert.equal(c.address, "100 Yard Rd", "parcel situs address, tidied");
assert.equal(c.city, "Testville");
assert.equal(c.currentOwnerName, "ACME HOLDINGS LLC", "appraisal-roll owner becomes the seller");
assert.equal(c.marketingStatus, "off_market");
assert.equal(c.acquisitionType, "slb", "owner-user site is a sale-leaseback lead");
assert.equal(c.acres, 3.2, "net usable acres preferred over gross");
assert(updates.some(([t, v]) => t === "deals" && v.stage === "outreach" && v.entered_pipeline_at === null), "lands in Outreach, off the pipeline");
assert(events.some((e) => e[1] === "sent_to_outreach" && e[2].via === "sweep"));
const evidence = events.find((e) => e[1] === "sourcing_sweep");
assert(evidence && evidence[2].appraisalRoll.owner === "ACME HOLDINGS LLC" && evidence[2].operators[0].phone === "713-555-0100", "sweep evidence on the deal history");
assert(filters.some(([t, k, v]) => t === "sourcing_sweeps" && k === "owner_email" && v === "owner@example.com"), "only the requester's own sweep");

// Sending the same site again returns the deal already made.
existing = { id: "deal-1" };
const again = await post({ sweepId: SWEEP, refs: ["S1"] });
assert.equal(again.body.results[0].dealId, "deal-1");
assert.equal(created.length, 1, "retry doesn't create a second deal");
existing = null;

// Someone else's sweep, bad input, too many sites, signed out.
user = { email: "someone@else.com" };
filters.length = 0;
assert.equal((await post({ sweepId: SWEEP, refs: ["S1"] })).status, 404);
user = { email: "owner@example.com" };
assert.equal((await post({ sweepId: "nope", refs: ["S1"] })).status, 400);
assert.equal((await post({ sweepId: SWEEP, refs: [] })).status, 400);
assert.equal((await post({ sweepId: SWEEP, refs: Array.from({ length: 26 }, (_, i) => `S${i + 1}`) })).status, 400);
user = null;
assert.equal((await post({ sweepId: SWEEP, refs: ["S1"] })).status, 401);

console.log("PASS: send sweep sites to outreach (owner-scoped, appraisal-roll owner, Outreach stage off the pipeline, evidence attached, one deal per site, active / conflicting sites refused).");
