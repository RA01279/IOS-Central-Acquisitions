// scripts/test-comp-market.mjs
//
// Tests lib/comps/market.ts: market rates, trimming, periods and effective rent.
//   node scripts/test-comp-market.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const loaded = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    { exports: loaded, require: (name) => dependencies[name] }
  );
  return loaded;
}
const rates = load("../lib/comps/rates.ts");
const { compRate, rateStats, recentHalves, halfOf, monthsBefore, marketView } = load("../lib/comps/market.ts", { "./rates": rates });

let n = 0;
const check = (label, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${label}`); throw e; } };
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// ---- rates
const yard = (over = {}) => ({ id: "y", comp_type: "lease", asset_class: "ios", market: "Dallas", rent: 8000, rent_basis: "per_acre_monthly", yard_acres: 3, lot_sf: 4 * 43560, date_commenced: "2026-06-01", ...over });
check("IOS lease is per acre as quoted", () => near(compRate(yard(), "ios").face, 8000));
check("IOS lease quoted in total is per yard acre", () => near(compRate(yard({ rent: 24000, rent_basis: "total_monthly" }), "ios").face, 8000));
check("industrial lease is per SF per year", () =>
  near(compRate({ comp_type: "lease", rent: 0.75, rent_basis: "per_sf_bldg_monthly", building_sf: 50000 }, "industrial").face, 9));
check("IOS sale is per acre of land", () => near(compRate({ comp_type: "sale", sale_price: 2000000, lot_sf: 4 * 43560 }, "ios").face, 500000));
check("industrial sale is per building SF", () => near(compRate({ comp_type: "sale", sale_price: 5000000, building_sf: 50000 }, "industrial").face, 100));
check("no size, no rate", () => assert.equal(compRate({ comp_type: "sale", sale_price: 5000000 }, "industrial"), null));

// ---- effective
check("no concessions: effective is face", () => {
  const r = compRate(yard({ lease_term_months: 60 }), "ios");
  assert.equal(r.concessions, false); near(r.effective, 8000);
});
check("free rent spread over the term", () => near(compRate(yard({ lease_term_months: 60, free_rent_months: 3 }), "ios").effective, 7600));
check("free rent without a term is not applied", () => assert.equal(compRate(yard({ free_rent_months: 3 }), "ios").concessions, false));
check("TI amortised for industrial", () =>
  near(compRate({ comp_type: "lease", rent: 9, rent_basis: "per_sf_bldg_annual", building_sf: 50000, lease_term_months: 60, ti_psf: 5 }, "industrial").effective, 8));
check("TI ignored for IOS", () => near(compRate(yard({ lease_term_months: 60, ti_psf: 5 }), "ios").effective, 8000));

// ---- stats
check("median and middle half", () => {
  const s = rateStats([1, 2, 3, 4, 5]);
  assert.equal(s.median, 3); assert.equal(s.p25, 2); assert.equal(s.p75, 4); assert.equal(s.trimmed, 0);
});
check("a unit error is trimmed, not averaged", () => {
  const s = rateStats([7000, 7500, 8000, 8200, 8500, 96000]);
  assert.equal(s.trimmed, 1); assert.equal(s.median, 8000);
});
check("two comps are not a market", () => assert.equal(rateStats([7000, 9000]).median, null));
check("too few to trim", () => assert.equal(rateStats([1, 2, 100]).trimmed, 0));

// ---- periods
check("halves", () => {
  assert.equal(halfOf("2026-06-30"), "2026 H1");
  assert.equal(halfOf("2026-07-01"), "2026 H2");
  assert.deepEqual([...recentHalves("2026-10-13", 4)], ["2025 H1", "2025 H2", "2026 H1", "2026 H2"]);
});
check("months before", () => assert.equal(monthsBefore("2026-10-13", 12), "2025-10-13"));

// ---- view
const today = "2026-10-13";
const comps = [
  ...[7000, 8000, 9000].map((r, i) => yard({ id: `d${i}`, rent: r, date_commenced: "2026-03-01" })),
  ...[6000, 6500, 7000].map((r, i) => yard({ id: `p${i}`, rent: r, date_commenced: "2025-03-01" })),
  yard({ id: "draft", rent: 50000, status: "draft" }),
  yard({ id: "ind", asset_class: "industrial" }),
  yard({ id: "none", asset_class: null }),
  ...[5000, 5500, 6000].map((r, i) => yard({ id: `h${i}`, market: "Houston", submarket: "North", rent: r, date_commenced: "2026-08-01" })),
];
const v = marketView(comps, "lease", "ios", { today });
const dallas = v.rows.find((r) => r.label === "Dallas");
check("current median", () => assert.equal(dallas.current.median, 8000));
check("prior median and change", () => { assert.equal(dallas.prior.median, 6500); near(dallas.change, 8000 / 6500 - 1, 1e-9); });
check("drafts and other classes stay out", () => assert.equal(dallas.total, 6));
check("unclassified counted", () => assert.equal(v.unclassified, 1));
check("overall spans markets", () => assert.equal(v.overall.current.count, 6));
check("trend aligned to halves", () => {
  assert.equal(v.halves.length, 6);
  assert.equal(dallas.trend[v.halves.indexOf("2026 H1")], 8000);
  assert.equal(dallas.trend[v.halves.indexOf("2026 H2")], null);
});
check("drill into a market by submarket", () => {
  const h = marketView(comps, "lease", "ios", { today, market: "houston" });
  assert.deepEqual([...h.rows.map((r) => r.label)], ["North"]);
  assert.equal(h.overall.current.median, 5500);
});
check("future-dated comps are ignored", () =>
  assert.equal(marketView([yard({ date_commenced: "2027-01-01" })], "lease", "ios", { today }).rows.length, 0));

console.log(`${n} market checks passed`);
