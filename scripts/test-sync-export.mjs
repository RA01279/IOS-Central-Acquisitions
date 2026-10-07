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

const { buildSyncPayload, shapeDeal, shapeComp, bearerMatches } = load("../lib/sync-export.ts");
const now = new Date("2026-09-23T15:00:00Z");

const acq = {
  id: "d1", deal_type: "acquisition", stage: "archived", asset_class: "ios", mla_status: "pending",
  contract_price: "1250000", pursuit_score: 4, follow_up_on: "2026-10-01", disposition: "not_selling",
  death_stage: "offered", created_by: "rhett@dalfen.com", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  properties: { address: "1 Main St", city: "Houston", market: "Houston", lot_sf: "217800", latitude: "29.76", longitude: "-95.36", geocode_precision: "rooftop" },
};
const lease = { id: "d2", deal_type: "lease", stage: "tour", properties: { address: "2 Lease Rd" } };
const legacy = { ...acq, id: "d3", stage: "uw_v1", properties: { ...acq.properties, geocode_precision: "approximate" } };

const payload = buildSyncPayload(
  {
    deals: [acq, lease, legacy],
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
assert.deepEqual(payload.deals.map((d) => d.id), ["d1", "d3"]);
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
