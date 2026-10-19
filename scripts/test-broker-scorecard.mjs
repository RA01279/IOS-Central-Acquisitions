// scripts/test-broker-scorecard.mjs
//
// Tests lib/broker-scorecard.ts: stage reach, LOIs, firm roll-up, comps by
// firm name, last touch.
//   node scripts/test-broker-scorecard.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/broker-scorecard.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m }
);

const deal = (id, stage, extra = {}) => ({ id, stage, death_stage: null, created_at: "2026-09-01T00:00:00Z", offers: [], documents: [], deal_events: [], ...extra });
const ann = { id: "c1", name: "Ann Broker", company_id: "f1", company_name: "Rich Young Co." };
const bob = { id: "c2", name: "Bob", company_id: "f1", company_name: "Rich Young Co." };
const out = m.scoreBrokers({
  links: [
    { role: "seller_broker", contact: ann, deal: deal("d1", "closed") },
    { role: "seller_broker", contact: ann, deal: deal("d2", "archived", { death_stage: "moving_to_psa", documents: [{ doc_type: "loi" }] }) },
    { role: "seller_broker", contact: ann, deal: deal("d3", "uw") },
    { role: "buyer_broker", contact: bob, deal: deal("d3", "uw") },
    { role: "seller", contact: bob, deal: deal("d9", "closed") },
  ],
  sourced: [],
  companies: [{ id: "f1", name: "Rich Young Co." }, { id: "f2", name: "SVN" }],
  compNotes: ["User-provided (Rich Young Co. - 3104 S Rigsbee IOS Lease Comps)", "rich young co. tracker", "SVNX", null],
  activities: [{ contact_id: "c2", company_id: null, occurred_at: "2026-10-10T00:00:00Z" }],
});
const a = out.people.find((p) => p.key === "c1");
assert.deepEqual([a.deals, a.active, a.offered, a.lois, a.psa, a.closed], [3, 1, 2, 1, 2, 1], "Ann: archived-at-PSA counts as PSA reached");
const b = out.people.find((p) => p.key === "c2");
assert.equal(b.deals, 1, "seller role is not a broker link");
assert.equal(b.lastTouch, "2026-10-10T00:00:00Z", "activity sets last touch");
const f = out.firms.find((x) => x.key === "f1");
assert.equal(f.deals, 3, "firm counts each deal once across its people");
assert.equal(f.comps, 2, "comps matched on firm name, word boundaries");
assert.equal(out.firms.some((x) => x.key === "f2"), false, "SVNX is not SVN");
assert.equal(out.people[0].key, "c1", "ranked by closed first");
console.log("broker-scorecard: 8 checks passed");
