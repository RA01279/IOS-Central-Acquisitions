// scripts/test-comp-underwriting.mjs
//
// Tests lib/comps/underwriting.ts: lease-up rent, exit value and sale growth.
//   node scripts/test-comp-underwriting.mjs
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
    { exports: loaded, require: (name) => dependencies[name], Date }
  );
  return loaded;
}
const rates = load("../lib/comps/rates.ts");
const match = load("../lib/comps/match.ts");
const market = load("../lib/comps/market.ts", { "./rates": rates });
const { compUnderwriting, saleGrowth } = load("../lib/comps/underwriting.ts", { "./match": match, "./market": market });

let n = 0;
const check = (label, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${label}`); throw e; } };
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

const today = new Date("2026-10-15T12:00:00Z");
const AC = 43560;
const subject = { lat: 32.8, lng: -96.8, buildingSf: 10000, lotSf: 5 * AC, coveragePct: 10000 / (5 * AC), assetClass: "ios", market: "Dallas", submarket: null };
let id = 0;
const lease = (over = {}) => ({ id: `l${id++}`, comp_type: "lease", asset_class: "ios", market: "Dallas", address: `${id} Main`, latitude: 32.81, longitude: -96.81, geocode_precision: "rooftop",
  rent: 8000, rent_basis: "per_acre_monthly", lot_sf: 4 * AC, building_sf: 8000, date_commenced: "2026-06-01", lease_term_months: 60, free_rent_months: 2, ...over });
const sale = (over = {}) => ({ id: `s${id++}`, comp_type: "sale", asset_class: "ios", market: "Dallas", address: `${id} Elm`, latitude: 32.81, longitude: -96.81, geocode_precision: "rooftop",
  sale_price: 2000000, lot_sf: 4 * AC, building_sf: 8000, closed_on: "2026-05-01", ...over });

// ---- lease-up from nearby comps
const leases = [lease(), lease({ rent: 9000 }), lease({ rent: 10000, free_rent_months: null })];
const uw = compUnderwriting([...leases], subject, { today });
check("nearby comps give a per-acre rent", () => { near(uw.lease.perAcreMonthly.mid, 9000, 0.06); assert.equal(uw.lease.perAcreMonthly.count, 3); });
check("source says nearby", () => assert.match(uw.lease.perAcreMonthly.source, /within 10 mi/));
check("per SF is per year", () => near(uw.lease.perSfAnnual.mid, (9000 * 4 / 8000) * 12, 0.06));
check("whole-site monthly rent is rate x lot acres", () => near(uw.lease.monthlyByAcre.mid, uw.lease.perAcreMonthly.mid * 5));
check("term median", () => assert.equal(uw.lease.termMonths, 60));
check("free rent only from comps that state it", () => { assert.equal(uw.lease.freeRentMonths, 2); assert.equal(uw.lease.freeCount, 2); });

// ---- class and fallback
check("industrial comps never set an IOS rent", () => {
  const r = compUnderwriting([...leases.map((c) => ({ ...c, asset_class: "industrial" }))], subject, { today });
  assert.equal(r.lease.perAcreMonthly.mid, null);
});
check("too few nearby falls back to the market median", () => {
  const far = [7000, 8000, 9000, 10000].map((rent) => lease({ rent, latitude: 33.5, longitude: -97.5 }));
  const r = compUnderwriting([...far], subject, { today });
  near(r.lease.perAcreMonthly.mid, 8500); assert.match(r.lease.perAcreMonthly.source, /Dallas market median/);
});
check("too few within 10 mi widens to 25 before the market label", () => {
  const mid = [7000, 8000, 9000].map((rent) => lease({ rent, market: "DFW", latitude: 32.95, longitude: -96.95 }));
  const r = compUnderwriting([...mid], { ...subject, market: "Forney" }, { today });
  near(r.lease.perAcreMonthly.mid, 8000, 0.1); assert.match(r.lease.perAcreMonthly.source, /within 25 mi/);
});
check("nothing anywhere says so", () => {
  const r = compUnderwriting([], subject, { today });
  assert.equal(r.lease.perAcreMonthly.mid, null); assert.match(r.lease.perAcreMonthly.source, /Not enough/);
});

// ---- exit value and growth
check("too few sales: growth held flat", () => {
  const g = saleGrowth([sale(), sale()], subject, "land", today);
  assert.equal(g.rate, 0); assert.match(g.note, /held flat/);
});
const yearly = [];
for (let y = 0; y < 5; y++) for (const k of [0.95, 1, 1.05]) yearly.push(sale({ sale_price: 2000000 * k * 1.05 ** y, closed_on: `${2021 + y}-11-01`, latitude: 33.5, longitude: -97.5 }));
check("growth is the trend in market sales", () => near(saleGrowth([...yearly], subject, "land", today).rate, 0.05, 0.01));
check("a runaway trend is capped", () => {
  const hot = yearly.map((c, i) => ({ ...c, sale_price: 2000000 * 1.3 ** Math.floor(i / 3) }));
  const g = saleGrowth([...hot], subject, "land", today);
  assert.equal(g.rate, 0.05); near(g.measured, 0.3, 0.02); assert.match(g.note, /capped/);
});
check("exit grows today's value by the hold", () => {
  const sales = [sale({ sale_price: 1800000 }), sale(), sale({ sale_price: 2200000 }), ...yearly];
  const r = compUnderwriting([...sales], subject, { today });
  const now = r.sale.perAcre.mid;
  const g = r.sale.growthAcre.rate;
  const at36 = r.sale.exits.find((e) => e.months === 36);
  near(at36.perAcre.mid, now * (1 + g) ** 3);
  near(at36.byAcre.mid, at36.perAcre.mid * 5 * 0.98);
  assert.deepEqual([...r.sale.exits.map((e) => e.months)], [36, 48, 60]);
});
check("no building SF, no per-SF value", () => {
  const r = compUnderwriting([sale(), sale(), sale()], { ...subject, buildingSf: null }, { today });
  assert.equal(r.sale.exits[0].bySf, null);
});

console.log(`${n} checks passed`);
