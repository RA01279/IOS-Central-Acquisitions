// scripts/test-comp-review.mjs
//
// Tests lib/comps/review.ts: which comps are held for a person, and how names
// are kept to one spelling. Cases are taken from the 2026-10-13 audit of the
// real repository.
//   node scripts/test-comp-review.mjs
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
const match = load("../lib/comps/match.ts");
const {
  cleanName, nameKey, canonicalSpellings, canonicalName, normalizeAddress, findDuplicate, isRateOutlier, marketUnitRate,
} = load("../lib/comps/review.ts", { "./match": match });

let n = 0;
const check = (label, fn) => { fn(); n++; };

// ---- names
check("typographic hyphen", () => assert.equal(cleanName("Mid‑Cities"), "Mid-Cities"));
check("whitespace", () => assert.equal(cleanName("  Great   Southwest "), "Great Southwest"));
check("blank is null", () => assert.equal(cleanName("   "), null));
check("variants share a key", () => {
  assert.equal(nameKey("Tri-county"), nameKey("Tri County"));
  assert.equal(nameKey("CanTex Capital"), nameKey("Cantex Capital"));
  assert.equal(nameKey("California Ave Properties"), nameKey("California Ave. Properties LLC"));
});
check("most common spelling wins", () => {
  const s = canonicalSpellings(["Tri County", "Tri County", "Tri-county", "Conroe"]);
  assert.equal(canonicalName("tri-county", s), "Tri County");
  assert.equal(canonicalName("Conroe", s), "Conroe");
});
check("an unseen name is kept as typed", () => assert.equal(canonicalName("New Braunfels ", new Map()), "New Braunfels"));

// ---- addresses
check("suffixes and directions", () => {
  assert.equal(normalizeAddress("5101 Village Creek Road, Fort Worth, TX"), normalizeAddress("5101 Village Creek Rd"));
  assert.equal(normalizeAddress("3513 North Loop 336 West"), normalizeAddress("3513 N Loop 336 W"));
});

// ---- duplicates
const lease = (over = {}) => ({
  id: "a", comp_type: "lease", address: "3412 Kelli Ct", latitude: 32.7, longitude: -97.3,
  rent: 12188, tenant_name: "The Landscape Partners", date_commenced: "2024-04-01", suite: null, project_name: null, ...over,
});
check("the workbook's 1st-vs-24th pair is a duplicate", () =>
  assert.equal(findDuplicate(lease({ id: "b", date_commenced: "2024-04-24" }), [lease()])?.id, "a"));
check("same tenant, rent revised, still a duplicate", () =>
  assert.equal(findDuplicate(lease({ id: "b", rent: 12500 }), [lease()])?.id, "a"));
check("address spelled differently, same pin: same site", () =>
  assert.equal(findDuplicate(lease({ id: "b", address: "3412 Kelli Court" }), [lease()])?.id, "a"));
check("address spelled differently, pin elsewhere: different site", () =>
  assert.equal(findDuplicate(lease({ id: "b", address: "3412 Kelli Court", latitude: 32.8 }), [lease()]), null));
check("a later lease at the same yard is a new comp", () =>
  assert.equal(findDuplicate(lease({ id: "b", date_commenced: "2026-03-01", rent: 12750, tenant_name: "Ginza" }), [lease()]), null));
check("a different suite is a different comp", () =>
  assert.equal(findDuplicate(lease({ id: "b", suite: "200" }), [lease({ suite: "100" })]), null));
check("different tenant and rent in the window is not a duplicate", () =>
  assert.equal(findDuplicate(lease({ id: "b", tenant_name: "Other Co", rent: 9000 }), [lease()]), null));
check("a lease never duplicates a sale", () =>
  assert.equal(findDuplicate(lease({ id: "b" }), [lease({ comp_type: "sale", closed_on: "2024-04-01", date_commenced: null })]), null));
const pine = (bldg) => ({
  id: bldg, comp_type: "sale", address: "3513 N Loop 336 W", latitude: 30.33, longitude: -95.48,
  sale_price: 860000, buyer: "Khattak Enterprises", closed_on: "2026-03-20", project_name: `Pine Crossing Business Park - Bldg. ${bldg}`,
});
check("two buildings in one park, same day and price, are two comps", () =>
  assert.equal(findDuplicate(pine("D"), [pine("C")]), null));
check("the same building twice is one", () =>
  assert.equal(findDuplicate({ ...pine("C"), id: "C2" }, [pine("C")])?.id, "C"));
check("no date, no judgement", () =>
  assert.equal(findDuplicate(lease({ id: "b", date_commenced: null }), [lease()]), null));

// ---- outliers
const yard = (i, rent, over = {}) => ({
  id: `y${i}`, comp_type: "lease", asset_class: "ios", market: "Dallas", rent, rent_basis: "per_acre_monthly",
  lot_sf: 2 * 43560, yard_acres: 2, ...over,
});
const dallas = Array.from({ length: 12 }, (_, i) => yard(i, 7000 + i * 200));
check("per-acre rate is per acre of lot", () => assert.equal(Math.round(marketUnitRate(yard(0, 8000))), 8000));
check("a normal rate passes", () => assert.equal(isRateOutlier(yard("x", 9000), dallas), false));
check("an annual figure read as monthly is held", () => assert.equal(isRateOutlier(yard("x", 96000), dallas), true));
check("a per-SF figure read as per acre is held", () => assert.equal(isRateOutlier(yard("x", 0.18), dallas), true));
check("too few peers: nothing to stand out from", () => assert.equal(isRateOutlier(yard("x", 96000), dallas.slice(0, 5)), false));
check("other markets don't count as peers", () =>
  assert.equal(isRateOutlier(yard("x", 96000, { market: "Laredo" }), dallas), false));

console.log(`${n} comp review checks passed`);
