// scripts/test-comp-match.mjs
//
// Tests lib/comps/match.ts against hand-computed numbers. The unit conversions
// get the most attention: an annual rate averaged against a monthly one is a
// 12x error that looks completely plausible in a list of dollar figures, and
// the output of this module lands in a market leasing assumption.
//   node scripts/test-comp-match.mjs
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const ts = (await import("typescript")).default;
const src = fileURLToPath(new URL("../lib/comps/match.ts", import.meta.url));
const tmp = new URL("../lib/comps/.match.test.mjs", import.meta.url);
writeFileSync(
  fileURLToPath(tmp),
  ts.transpileModule(readFileSync(src, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
);
const { unitValue, ageMonths, scoreComps, suggestRange, haversineMiles, formatUnit } = await import(
  tmp.href
);

let pass = 0, fail = 0;
function near(label, actual, expected, tol = 0.005) {
  const ok = actual !== null && Math.abs(actual - expected) <= tol;
  if (ok) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ~${expected}, got ${actual}`); }
}
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
const TODAY = new Date("2026-09-03T12:00:00Z");
const ACRE = 43560;

// ---------------------------------------------------------- unit conversions
console.log("== unit conversions ==");
// Doc Perrier's real lease comp: $11,385/mo on 9,900 SF = $1.15/SF/mo.
near("total monthly -> $/SF bldg/mo",
  unitValue({ id: "1", comp_type: "lease", address: "a", rent: 11385, rent_basis: "total_monthly", building_sf: 9900 }, "building"),
  1.15);
// Already per SF monthly: passes through.
near("per_sf_bldg_monthly passthrough",
  unitValue({ id: "2", comp_type: "lease", address: "a", rent: 1.15, rent_basis: "per_sf_bldg_monthly", building_sf: 9900 }, "building"),
  1.15);
// The Conroe workbook quotes annual: $13.56/yr = $1.13/mo. THE 12x CASE.
near("per_sf_bldg_annual -> monthly",
  unitValue({ id: "3", comp_type: "lease", address: "a", rent: 13.56, rent_basis: "per_sf_bldg_annual", building_sf: 9750 }, "building"),
  1.13);
// IOS yard quote: $4,500/acre/mo on 5 acres = $22,500/mo; over 9,900 SF bldg.
near("per_acre_monthly -> $/SF bldg/mo",
  unitValue({ id: "4", comp_type: "lease", address: "a", rent: 4500, rent_basis: "per_acre_monthly", building_sf: 9900, lot_sf: 5 * ACRE }, "building"),
  22500 / 9900);
// Same comp on a LAND basis: $4,500/acre/mo = $0.1033/SF land/mo.
near("per_acre_monthly -> $/SF land/mo",
  unitValue({ id: "5", comp_type: "lease", address: "a", rent: 4500, rent_basis: "per_acre_monthly", building_sf: 9900, lot_sf: 5 * ACRE }, "land"),
  4500 / ACRE, 0.0001);
near("per_sf_land_monthly -> land passthrough",
  unitValue({ id: "6", comp_type: "lease", address: "a", rent: 0.1, rent_basis: "per_sf_land_monthly", lot_sf: 100000 }, "land"),
  0.1);
// Sales: Doc's 2933 E Davis St, $1,485,000 / 9,900 SF = $150.00.
near("sale -> $/SF building",
  unitValue({ id: "7", comp_type: "sale", address: "a", sale_price: 1485000, building_sf: 9900 }, "building"),
  150);
near("sale -> $/SF land",
  unitValue({ id: "8", comp_type: "sale", address: "a", sale_price: 1485000, lot_sf: 1.4 * ACRE }, "land"),
  1485000 / (1.4 * ACRE), 0.01);
// Missing the denominator must yield null, never a guess.
eq("no building SF -> null",
  unitValue({ id: "9", comp_type: "sale", address: "a", sale_price: 1000000 }, "building"), null);
eq("total monthly with no building SF -> null",
  unitValue({ id: "10", comp_type: "lease", address: "a", rent: 5000, rent_basis: "total_monthly" }, "building"), null);
eq("unknown basis -> null",
  unitValue({ id: "11", comp_type: "lease", address: "a", rent: 5000, rent_basis: "per_widget", building_sf: 1000 }, "building"), null);

// ------------------------------------------------------------------ distance
console.log("\n== distance and age ==");
// Conroe -> Houston, roughly 40 miles.
const d = haversineMiles(30.3119, -95.4561, 29.7604, -95.3698);
near("Conroe to Houston", d, 38.5, 2.5);
near("age in months", ageMonths({ id: "a", comp_type: "sale", address: "a", closed_on: "2026-03-03" }, TODAY), 6, 0.2);
eq("no date -> null age", ageMonths({ id: "a", comp_type: "sale", address: "a" }, TODAY), null);

// --------------------------------------------------------------- the ranking
console.log("\n== scoring and ranking ==");
const SUBJECT = {
  lat: 30.3119, lng: -95.4561, buildingSf: 10000, lotSf: 2 * ACRE,
  coveragePct: 10000 / (2 * ACRE), assetClass: "industrial",
  market: "Houston", submarket: "Conroe",
};
const mk = (id, over = {}) => ({
  id, comp_type: "sale", address: `${id} St`, latitude: 30.32, longitude: -95.46,
  building_sf: 10000, lot_sf: 2 * ACRE, coverage_pct: 10000 / (2 * ACRE),
  sale_price: 1500000, closed_on: "2026-06-01", submarket: "Conroe", ...over,
});

// Near/recent must outrank far/old.
// "far" sits ~7.6 miles out: inside the default 15-mile radius, so this tests
// the RANKING rather than the radius filter (covered separately below). The age
// limit is lifted here so the stale comp is ranked rather than filtered.
const ranked = scoreComps(
  [
    mk("far", { latitude: 30.42, longitude: -95.4561 }),
    mk("near"),
    mk("old", { closed_on: "2021-01-01" }),
  ],
  SUBJECT, "sale", { today: TODAY, maxAgeMonths: 120 }
);
eq("nearest and most recent ranks first", ranked[0].comp.id, "near");
eq("all three eligible", ranked.filter((r) => !r.excluded).length, 3);
eq("a moderately distant recent comp beats a very stale one", ranked[1].comp.id, "far");

// THE CROSSOVER, locked in deliberately.
//
// Under the earlier distance-heavy weights these two scored 0.768 and 0.764 --
// a coin flip between a stale comp next door and a fresh one 7.6 miles out.
// Recency is now the heaviest factor with a steeper curve, so fresh-but-farther
// must win clearly. If a future tuning pass flips this, that should be a
// choice, not a surprise.
const crossover = scoreComps(
  [
    mk("stale_next_door", { closed_on: "2024-01-01" }), // ~32 months, ~0.6 mi
    mk("fresh_7_miles", { closed_on: "2026-06-01", latitude: 30.42, longitude: -95.4561 }),
  ],
  SUBJECT, "sale", { today: TODAY, maxAgeMonths: 120 }
);
eq("fresh-but-farther now outranks stale-next-door", crossover[0].comp.id, "fresh_7_miles");
const gap = crossover[0].score - crossover[1].score;
eq("...and by a clear margin, not a hair", gap > 0.15, true);
// Recency must decay to nothing by roughly two years. Tested past the boundary
// rather than on it: age is measured in average months (30.44 days), so exactly
// 730 days works out at 23.98 months and still scores a rounding crumb.
eq("recency is zero beyond the falloff",
  scoreComps([mk("stale", { closed_on: "2024-01-01" })], SUBJECT, "sale", { today: TODAY, maxAgeMonths: 120 })[0].factors.recency,
  0);
near("...and is nearly zero right at two years",
  scoreComps([mk("twoyears", { closed_on: "2024-09-03" })], SUBJECT, "sale", { today: TODAY, maxAgeMonths: 120 })[0].factors.recency,
  0, 0.01);
near("a one-year-old comp scores half on recency",
  scoreComps([mk("oneyear", { closed_on: "2025-09-03" })], SUBJECT, "sale", { today: TODAY })[0].factors.recency,
  0.5, 0.02);

// Filters exclude rather than merely down-weight.
const filtered = scoreComps(
  [mk("inside"), mk("outside", { latitude: 31.5, longitude: -96.5 })],
  SUBJECT, "sale", { today: TODAY, radiusMiles: 10 }
);
eq("outside the radius is excluded", filtered.find((r) => r.comp.id === "outside")?.excluded !== undefined, true);
eq("inside is not", filtered.find((r) => r.comp.id === "inside")?.excluded, undefined);

const aged = scoreComps([mk("stale", { closed_on: "2020-01-01" })], SUBJECT, "sale", { today: TODAY, maxAgeMonths: 24 });
eq("too old is excluded", aged[0].excluded !== undefined, true);

// A missing factor must not penalise the comp: weights renormalise over what
// is known, so an otherwise-identical comp with no coverage still scores 1.
const noCoverage = scoreComps([mk("nocov", { coverage_pct: null })], SUBJECT, "sale", { today: TODAY });
eq("missing coverage isn't penalised", noCoverage[0].factors.coverage, null);
near("...and the score still reflects the rest", noCoverage[0].score, scoreComps([mk("full")], SUBJECT, "sale", { today: TODAY })[0].score, 0.06);

// Only the top N feed the range.
const many = scoreComps(Array.from({ length: 12 }, (_, i) => mk(`c${i}`)), SUBJECT, "sale", { today: TODAY, topN: 5 });
eq("topN caps the contributors", many.filter((r) => r.inRange).length, 5);

// A hand-exclusion is honoured and labelled as the user's, not a filter's.
const byHand = scoreComps([mk("keep"), mk("drop")], SUBJECT, "sale", { today: TODAY, excludedIds: ["drop"] });
eq("user exclusion respected", byHand.find((r) => r.comp.id === "drop")?.excludedByUser, true);
eq("...and it doesn't feed the range", byHand.find((r) => r.comp.id === "drop")?.inRange, false);

// -------------------------------------------------------------- the range
console.log("\n== suggested range ==");
// Three identical-quality comps at $140/$150/$160 -> mid $150.
const three = scoreComps(
  [
    mk("a", { sale_price: 1400000 }),
    mk("b", { sale_price: 1500000 }),
    mk("c", { sale_price: 1600000 }),
  ],
  SUBJECT, "sale", { today: TODAY }
);
const range = suggestRange(three, "sale", "building");
eq("count", range.count, 3);
near("mid is the weighted mean", range.mid, 150, 0.5);
eq("low <= mid <= high", range.low <= range.mid && range.mid <= range.high, true);

// Nothing eligible -> nulls and an explanation, not a zero.
const emptyRange = suggestRange(
  scoreComps([mk("far", { latitude: 33, longitude: -97 })], SUBJECT, "sale", { today: TODAY, radiusMiles: 5 }),
  "sale", "building"
);
eq("no comps -> null mid, not 0", emptyRange.mid, null);
eq("...and says why", emptyRange.caveats.length > 0, true);

// Thin evidence is called out.
const thin = suggestRange(scoreComps([mk("only")], SUBJECT, "sale", { today: TODAY }), "sale", "building");
eq("single comp flagged as thin", thin.caveats.some((c) => /thin evidence/i.test(c)), true);

// Mixed lease structures aren't comparable rents.
const mixed = scoreComps(
  [
    { ...mk("nnn"), comp_type: "lease", rent: 1.1, rent_basis: "per_sf_bldg_monthly", date_commenced: "2026-06-01", lease_type: "nnn", sale_price: null, closed_on: null },
    { ...mk("gross"), comp_type: "lease", rent: 1.4, rent_basis: "per_sf_bldg_monthly", date_commenced: "2026-06-01", lease_type: "gross", sale_price: null, closed_on: null },
  ],
  SUBJECT, "lease", { today: TODAY }
);
const mixedRange = suggestRange(mixed, "lease", "building");
eq("mixed structures flagged", mixedRange.caveats.some((c) => /lease structures/i.test(c)), true);

// Repeated addresses over-weight one property. Found in real data: a business
// park selling building by building put three separate sales at "3513 N Loop
// 336 W" into a single eight-comp average.
const repeated = suggestRange(
  scoreComps(
    [
      mk("r1", { address: "3513 N Loop 336 W", sale_price: 1400000 }),
      mk("r2", { address: "3513 N Loop 336 W", sale_price: 1400000 }),
      mk("r3", { address: "Somewhere Else Rd", sale_price: 1600000 }),
    ],
    SUBJECT, "sale", { today: TODAY }
  ),
  "sale", "building"
);
eq("repeated address disclosed", repeated.caveats.some((c) => /same address/i.test(c)), true);
eq("...but both are still counted", repeated.count, 3);
const notRepeated = suggestRange(
  scoreComps([mk("u1", { address: "A St" }), mk("u2", { address: "B St" })], SUBJECT, "sale", { today: TODAY }),
  "sale", "building"
);
eq("distinct addresses raise no such caveat", notRepeated.caveats.some((c) => /same address/i.test(c)), false);

// Reaching a long way for evidence is disclosed.
const reachy = suggestRange(
  scoreComps([mk("far", { latitude: 30.5, longitude: -95.65 })], SUBJECT, "sale", { today: TODAY, radiusMiles: 30 }),
  "sale", "building"
);
eq("long reach disclosed", reachy.caveats.some((c) => /miles out/i.test(c)), true);

console.log("\n== formatting ==");
eq("lease building unit", formatUnit(1.15, "lease", "building"), "$1.15/SF/mo");
eq("lease land unit", formatUnit(0.103, "lease", "land"), "$0.103/SF land/mo");
eq("sale building unit", formatUnit(150, "sale", "building"), "$150.00/SF");
eq("sale land unit", formatUnit(24.34, "sale", "land"), "$24.34/SF land");
eq("null unit", formatUnit(null, "sale", "building"), "—");

unlinkSync(fileURLToPath(tmp));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
