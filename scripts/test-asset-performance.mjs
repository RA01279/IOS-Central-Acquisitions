// scripts/test-asset-performance.mjs
//
// Tests lib/asset-performance.ts: actual rent / yield / occupancy / WALT from
// a rent roll, in-place rent conversion, expiry window.
//   node scripts/test-asset-performance.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/asset-performance.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m }
);
const lease = (o) => ({ id: "x", tenant: "T", suite: null, leased_sf: null, leased_acres: null, commenced_on: null, expires_on: null, base_rent_monthly: null, escalation_pct: null, lease_type: null, options: null, status: "active", notes: null, ...o });
const asset = { site_acres: 5, building_sf: null, purchase_price: 4000000, acquisition_costs: 100000, purchased_on: "2025-10-19", sale_price: null, selling_costs: null, sold_on: null, status: "owned", asset_class: "ios" };
const p = m.performance({
  today: "2026-10-19",
  asset,
  deal: { closed_price: 4000000, closed_on: "2025-10-19", in_place_rent: 8000, in_place_rent_basis: "per_acre_monthly", lot_sf: 5 * 43560, building_sf: null },
  returns: { purchasePrice: 4000000, goingInYieldPct: 0.11, exitCapPct: 0.065, irrPct: 0.18, equityMultiple: 1.9, holdPeriodYears: 4 },
  leases: [
    lease({ leased_acres: 3, base_rent_monthly: 25000, expires_on: "2028-10-19" }),
    lease({ leased_acres: 1, base_rent_monthly: 10000, expires_on: "2027-04-19" }),
    lease({ leased_acres: 1, base_rent_monthly: 9000, expires_on: "2026-01-01" }),
    lease({ leased_acres: 1, base_rent_monthly: 9000, status: "terminated" }),
  ],
});
let n = 0;
const near = (a, b, label, tol = 1e-6) => { assert.ok(Math.abs(a - b) < tol, `${label}: ${a} vs ${b}`); n++; };
near(p.actual.rent, 35000 * 12, "actual rent counts only live leases");
near(p.actual.yieldOnCost, 420000 / 4100000, "yield on price + acquisition costs");
near(p.actual.occupancy, 4 / 5, "occupancy of site acres");
near(p.uw.rent, 8000 * 5 * 12, "UW in-place rent per acre per month annualised");
near(p.actual.walt, (25000 * 2 + 10000 * (182 / 365.25)) / 35000, "rent-weighted WALT", 0.01);
near(p.actual.heldYears, 1, "held one year", 0.01);
assert.equal(m.annualInPlaceRent(2, "per_sf_bldg_annual", null, 1000), 2000); n++;
assert.equal(m.annualInPlaceRent(5, "per_sf_bldg_annual", null, null), null, "needs building SF"); n++;
const exp = m.expiringLeases([lease({ expires_on: "2027-03-01" }), lease({ expires_on: "2027-06-01" }), lease({ expires_on: "2026-12-01", status: "expired" })], "2026-10-19");
assert.equal(exp.length, 1, "180-day window, active only"); n++;
console.log(`asset-performance: ${n} checks passed`);
