// scripts/test-sync-export.mjs -- the Prospector mirror feed's shapes, pinned.
//
// Prospector upserts by id and deletes what is missing, so the failure that
// matters is a row that goes missing or moves. Run: node scripts/test-sync-export.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: () => assert.fail("no deps"), Number, String, Set, Date, Array });
  return exports;
}

const { buildSyncPayload, shapeDeal, shapeOffer, shapeComp, bearerMatches } = load("../lib/sync-export.ts");
const now = new Date("2026-09-23T15:00:00Z");

const acq = {
  id: "d1", deal_type: "acquisition", stage: "archived", asset_class: "ios", mla_status: "pending",
  contract_price: "1250000", pursuit_score: 4, follow_up_on: "2026-10-01", disposition: "not_selling",
  death_stage: "offered", created_by: "rhett@dalfen.com", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  properties: { address: "1 Main St", city: "Houston", market: "Houston", lot_sf: "217800", latitude: "29.76", longitude: "-95.36", geocode_precision: "rooftop" },
};
const lease = { id: "d2", deal_type: "lease", stage: "tour", properties: { address: "2 Lease Rd" } };
const legacy = { ...acq, id: "d3", stage: "uw_v1", properties: { ...acq.properties, geocode_precision: "approximate" } };
// a site of a portfolio OM: names its portfolio and carries the allocated price
const site = {
  ...acq, id: "d4", stage: "prospect", deal_portfolio_id: "p1", asking_price: "2500000",
  deal_portfolios: { name: "Project Empire IOS Portfolio", seller_broker: "CBRE, Inc." },
  properties: { ...acq.properties, address: "4810 Cargo Rd" },
};

const payload = buildSyncPayload(
  {
    deals: [acq, lease, legacy, site],
    offers: [
      { id: "o1", deal_id: "d1", offered_at: "2026-08-15", price: "1000000", source: "loi", created_by: "r" },
      { id: "o2", deal_id: "d2", offered_at: "2026-08-15", price: 5 },
      { id: "o3", deal_id: "gone", price: 5 },
    ],
    tasks: [
      { id: "t1", deal_id: "d1", title: "Call owner", due_date: "2026-09-30", status: "open", assigned_to: "meti@dalfen.com" },
      { id: "t2", deal_id: null, title: "Loose task", status: "done", completed_at: "2026-09-01T00:00:00Z" },
      { id: "t3", deal_id: "d2", title: "Lease task", status: "open" },
      { id: "t4", deal_id: "d2", contact_id: "c1", title: "Lease task about a person", status: "open" },
      { id: "t5", deal_id: null, company_id: "co1", title: "Company task", status: "open" },
    ],
    companies: [
      { id: "co1", name: "Acme Brokerage", company_type: "broker", created_at: "2026-07-01T00:00:00Z" },
      { id: "co2", name: "", company_type: "landlord" },
    ],
    contacts: [
      {
        id: "c1", company_id: "co1", name: "Dana Reyes", email: "dana@acme.com", phone: "713-555-0100",
        title: "Principal", address: "9 Loop Rd", contact_type: "broker", created_at: "2026-07-02T00:00:00Z",
      },
      { id: "c2", company_id: null, name: "Sam Owner", email: "", phone: null, contact_type: null },
    ],
    dealContacts: [
      { id: "l1", deal_id: "d1", contact_id: "c1", role: "seller_broker" },
      { id: "l2", deal_id: "d2", contact_id: "c1", role: "tenant_broker" },
      { id: "l3", deal_id: "d1", contact_id: "gone", role: "seller" },
    ],
    activities: [
      {
        id: "a1", activity_type: "call", subject: "Intro call", body: "Left a voicemail",
        occurred_at: "2026-09-01T14:00:00Z", contact_id: "c1", company_id: "co1", deal_id: "d1", created_by: "rhett@dalfen.com",
      },
      { id: "a2", activity_type: "tour", subject: "Lease tour", deal_id: "d2", created_by: "r" },
      { id: "a3", activity_type: "note", subject: "Lease note on a person", deal_id: "d2", contact_id: "c1", created_by: "r" },
      { id: "a4", activity_type: "note", subject: "Loose note", created_by: "r" },
    ],
  },
  { now, asOfDate: "2026-09-23" }
);

// Envelope.
assert.equal(payload.source, "hopper");
assert.equal(payload.schemaVersion, 2);
assert.equal(payload.generatedAt, "2026-09-23T15:00:00.000Z");

// Only acquisitions, every stage, uuids as ids.
assert.deepEqual(payload.deals.map((d) => d.id), ["d1", "d3", "d4"]);
const d1 = payload.deals[0];
assert.equal(d1.stage, "archived");
assert.equal(d1.contractPrice, 1250000);
assert.equal(d1.lotSf, 217800);
assert.equal(d1.pursuitScore, 4);
assert.equal(d1.latitude, 29.76);
assert.equal(d1.url, "https://ios-central-acquisitions.vercel.app/deals/d1");
// Legacy uw_v1 reads as uw; an 'approximate' geocode carries no coordinates.
assert.equal(payload.deals[1].stage, "uw");
assert.equal(payload.deals[1].latitude, null);
assert.equal(payload.deals[1].geocodePrecision, null);

// Offers on lease or unknown deals are dropped; price is a number.
assert.deepEqual(payload.offers.map((o) => o.id), ["o1"]);
assert.equal(payload.offers[0].price, 1000000);
assert.equal(payload.offers[0].source, "loi");

// Tasks: deal-linked acquisition tasks and unlinked tasks come through; lease tasks do not --
// unless they are about a person or a company, in which case they travel without the lease deal.
assert.deepEqual(payload.tasks.map((t) => t.id), ["t1", "t2", "t4", "t5"]);
assert.equal(payload.tasks[1].dealId, null);
assert.equal(payload.tasks[1].status, "done");
assert.equal(payload.tasks[2].dealId, null);
assert.equal(payload.tasks[2].contactId, "c1");
assert.equal(payload.tasks[3].companyId, "co1");
assert.equal(payload.tasks[0].contactId, null);

// Companies and people: every row, contact details included (this feed has its own key).
assert.deepEqual(payload.companies.map((c) => c.id), ["co1", "co2"]);
assert.deepEqual(
  { ...payload.companies[0] },
  { id: "co1", name: "Acme Brokerage", type: "broker", createdAt: "2026-07-01T00:00:00Z" }
);
assert.equal(payload.companies[1].name, "");
assert.deepEqual(
  { ...payload.contacts[0] },
  {
    id: "c1", companyId: "co1", name: "Dana Reyes", email: "dana@acme.com", phone: "713-555-0100",
    title: "Principal", address: "9 Loop Rd", contactType: "broker", createdAt: "2026-07-02T00:00:00Z",
  }
);
assert.equal(payload.contacts[1].companyId, null);
assert.equal(payload.contacts[1].email, null);
assert.equal(payload.contacts[1].contactType, null);

// Links: only between an acquisition deal and a person who is in the payload.
assert.deepEqual(payload.dealContacts.map((l) => l.id), ["l1"]);
assert.deepEqual({ ...payload.dealContacts[0] }, { id: "l1", dealId: "d1", contactId: "c1", role: "seller_broker" });

// Activities follow the task rule: a lease-only one is dropped, one about a person is kept without the deal.
assert.deepEqual(payload.activities.map((a) => a.id), ["a1", "a3", "a4"]);
assert.deepEqual(
  { ...payload.activities[0] },
  {
    id: "a1", type: "call", subject: "Intro call", body: "Left a voicemail", occurredAt: "2026-09-01T14:00:00Z",
    contactId: "c1", companyId: "co1", dealId: "d1", createdBy: "rhett@dalfen.com",
  }
);
assert.equal(payload.activities[1].dealId, null);
assert.equal(payload.activities[1].contactId, "c1");

// The key: exact match only, and an unset secret never matches anything.
assert.equal(bearerMatches("Bearer s3cret", "s3cret"), true);
assert.equal(bearerMatches("Bearer s3cres", "s3cret"), false);
assert.equal(bearerMatches("Bearer s3cret-and-more", "s3cret"), false);
assert.equal(bearerMatches("s3cret", "s3cret"), false);
assert.equal(bearerMatches(null, "s3cret"), false);
assert.equal(bearerMatches("Bearer ", ""), false);
assert.equal(bearerMatches("Bearer undefined", undefined), false);

// Blank strings never become 0 or "".
assert.equal(shapeDeal({ id: "x", properties: { lot_sf: "" , address: "" } }).lotSf, null);
assert.equal(shapeDeal({ id: "x", properties: { address: "" } }).address, null);
// (0, 0) is not a location.
assert.equal(shapeDeal({ id: "x", properties: { latitude: 0, longitude: 0, geocode_precision: "manual" } }).latitude, null);

// Comps: every row, both kinds, numbers as numbers; absent -> empty list.
const leaseComp = shapeComp({ id: "c1", comp_type: "lease", address: "5 Yard Rd", latitude: "29.77", longitude: "-95.37",
  rent: "4500", rent_basis: "per_acre_monthly", date_commenced: "2026-05-01", date_estimated: false, tenant_name: "Acme" });
assert.equal(leaseComp.compType, "lease");
assert.equal(leaseComp.rent, 4500);
assert.equal(leaseComp.latitude, 29.77);
assert.equal(leaseComp.rentBasis, "per_acre_monthly");
assert.equal(leaseComp.dateEstimated, false);
const sale = shapeComp({ id: "c2", comp_type: "sale", address: "9 Sold Ln", sale_price: "2400000", closed_on: "2026-03-15", date_estimated: true });
assert.equal(sale.salePrice, 2400000);
assert.equal(sale.closedOn, "2026-03-15");
assert.equal(sale.rent, null);
assert.equal(sale.dateEstimated, true);
const withComps = buildSyncPayload(
  { deals: [], offers: [], tasks: [], companies: [], contacts: [], dealContacts: [], activities: [],
    comps: [{ id: "c1", comp_type: "lease", address: "5 Yard Rd" }, { id: "c2", comp_type: "sale", address: "9 Sold Ln" }] },
  { now, asOfDate: "2026-09-23" });
assert.equal(JSON.stringify(withComps.comps.map((c) => [c.id, c.compType])), JSON.stringify([["c1", "lease"], ["c2", "sale"]]));
assert.equal(buildSyncPayload(
  { deals: [], offers: [], tasks: [], companies: [], contacts: [], dealContacts: [], activities: [] },
  { now, asOfDate: "2026-09-23" }).comps.length, 0);

console.log("sync-export: ok");

// Portfolio deals (2026-10-16): the site names its portfolio and carries
// the OM's allocated price; a deal outside any portfolio sends nulls.
const siteOut = payload.deals.find((d) => d.id === "d4");
assert.equal(siteOut.dealPortfolioId, "p1");
assert.equal(siteOut.portfolioName, "Project Empire IOS Portfolio");
assert.equal(siteOut.portfolioBroker, "CBRE, Inc.");
assert.equal(siteOut.askingPrice, 2500000);
const lone = payload.deals.find((d) => d.id === "d1");
assert.equal(lone.dealPortfolioId, null);
assert.equal(lone.portfolioName, null);
assert.equal(lone.askingPrice, null);
console.log("portfolio fields ok");

// Oct 19 2026: diligence, sourcing, the seller's response, IC decisions,
// milestones, owned assets and leases. All additive.
assert.equal(shapeDeal({ id: "x", psa_effective_on: "2026-11-01", source_broker_id: "co1" }).psaEffectiveOn, "2026-11-01");
assert.equal(shapeDeal({ id: "x", source_broker_id: "co1" }).sourceBrokerId, "co1");
assert.equal(shapeDeal({ id: "x" }).psaEffectiveOn, null);
const plainOffer = shapeOffer({ id: "o9", deal_id: "d1", price: "100" });
assert.equal(plainOffer.status, "sent");
assert.equal(plainOffer.counterPrice, null);
const countered = shapeOffer({ id: "o9", deal_id: "d1", price: "100", status: "countered", counter_price: "120", responded_on: "2026-10-18" });
assert.equal(countered.status, "countered");
assert.equal(countered.counterPrice, 120);
assert.equal(countered.respondedOn, "2026-10-18");
assert.equal(shapeOffer({ id: "o9", deal_id: "d1", status: "bogus" }).status, "sent");
assert.equal(shapeComp({ id: "c1", comp_type: "lease", source_ref: "User-provided (Rich Young Co.)" }).sourceRef, "User-provided (Rich Young Co.)");
const extra = buildSyncPayload(
  {
    deals: [{ id: "d1", deal_type: "acquisition", stage: "uw" }, { id: "L1", deal_type: "lease", stage: "prospect" }],
    offers: [], tasks: [], companies: [], contacts: [], dealContacts: [], activities: [],
    icDecisions: [
      { id: "i1", deal_id: "d1", decided_on: "2026-10-17", outcome: "conditional", approved_price: "2500000", conditions: "Phase II clean" },
      { id: "i2", deal_id: "L1", decided_on: "2026-10-17", outcome: "approved" },
      { id: "i3", deal_id: "nope", decided_on: "2026-10-17", outcome: "approved" },
    ],
    milestones: [
      { id: "m1", deal_id: "d1", key: "dd_end", label: "DD expiry", due_on: "2026-12-31", sort_order: 90 },
      { id: "m2", deal_id: "L1", key: "closing", label: "Closing" },
    ],
    assets: [
      { id: "a1", address: "100 Yard Rd", city: "Houston", state: "TX", status: "owned", occupancy: "occupied", site_acres: "4.2", latitude: "29.7", longitude: "-95.3", geocode_precision: "rooftop" },
      { id: "a2", address: "200 Approx St", latitude: "29.7", longitude: "-95.3", geocode_precision: "approximate" },
    ],
    leases: [
      { id: "l1", asset_id: "a1", tenant: "Acme Trucking", expires_on: "2027-03-31", base_rent_monthly: "18000", escalation_pct: "0.03", status: "active" },
      { id: "l2", asset_id: "a1", tenant: "Gone Inc", status: "nonsense" },
      { id: "l3", asset_id: "zzz", tenant: "Orphan" },
    ],
  },
  { now, asOfDate: "2026-10-19" }
);
assert.equal(JSON.stringify(extra.icDecisions.map((r) => r.id)), JSON.stringify(["i1"]));
assert.equal(extra.icDecisions[0].approvedPrice, 2500000);
assert.equal(extra.icDecisions[0].conditions, "Phase II clean");
assert.equal(JSON.stringify(extra.milestones.map((m) => m.id)), JSON.stringify(["m1"]));
assert.equal(extra.milestones[0].sortOrder, 90);
assert.equal(extra.assets.length, 2);
assert.equal(extra.assets[0].siteAcres, 4.2);
assert.equal(extra.assets[0].latitude, 29.7);
assert.equal(extra.assets[1].latitude, null, "an approximate pin does not travel");
assert.equal(JSON.stringify(extra.leases.map((l) => l.id)), JSON.stringify(["l1", "l2"]), "a lease without its asset is dropped");
assert.equal(extra.leases[0].baseRentMonthly, 18000);
assert.equal(extra.leases[0].escalationPct, 0.03);
assert.equal(extra.leases[1].status, "active", "an unknown lease status reads active");
const bare = buildSyncPayload(
  { deals: [], offers: [], tasks: [], companies: [], contacts: [], dealContacts: [], activities: [] },
  { now, asOfDate: "2026-10-19" }
);
assert.equal(bare.icDecisions.length + bare.milestones.length + bare.assets.length + bare.leases.length, 0);
assert.equal(bare.schemaVersion, 2);
console.log("oct-19 collections ok");

// Oct 20 2026: the deal's short ref, lease concessions on comps, closing
// checklist items and site viability flags. All additive.
assert.equal(shapeDeal({ id: "x", ref: 1042 }).ref, "1042");
assert.equal(shapeDeal({ id: "x" }).ref, null);
const concession = shapeComp({ id: "c1", comp_type: "lease", lease_term_months: 60, free_rent_months: "2", escalations_pct: "0.03", ti_psf: null });
assert.equal(concession.leaseTermMonths, 60);
assert.equal(concession.freeRentMonths, 2);
assert.equal(concession.escalationsPct, 0.03);
assert.equal(concession.tiPsf, null);
const oct20 = buildSyncPayload(
  {
    deals: [{ id: "d1", deal_type: "acquisition", stage: "uw" }, { id: "L1", deal_type: "lease", stage: "prospect" }],
    offers: [], tasks: [], companies: [], contacts: [], dealContacts: [], activities: [],
    checklistItems: [
      { id: "k1", deal_id: "d1", section: "TITLE", item: "Title commitment", status: "Received", done: true, sort_order: 10 },
      { id: "k2", deal_id: "L1", item: "Lease item" },
    ],
    signals: [
      { deal_id: "d1", key: "zoning", auto_state: "watch", auto_note: "IR; outdoor storage not confirmed", override_state: "strong", override_note: "SUP on file", override_by: "rhett@dalfen.com" },
      { deal_id: "L1", key: "demand", auto_state: "weak" },
    ],
  },
  { now, asOfDate: "2026-10-20" }
);
assert.equal(JSON.stringify(oct20.checklistItems.map((r) => r.id)), JSON.stringify(["k1"]));
assert.equal(oct20.checklistItems[0].done, true);
assert.equal(oct20.checklistItems[0].section, "TITLE");
assert.equal(JSON.stringify(oct20.signals.map((r) => r.id)), JSON.stringify(["d1:zoning"]));
assert.equal(oct20.signals[0].overrideState, "strong");
assert.equal(bare.checklistItems.length + bare.signals.length, 0);
console.log("oct-20 collections ok");
