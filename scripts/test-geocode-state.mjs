// scripts/test-geocode-state.mjs
//
// Tests the state resolver in lib/geocode.ts.
//
// This exists because the geocoder used to default to "TX" and pass it as
// `administrative_area`, which is a HARD filter -- Google cannot return a
// result outside it, and returns the state centroid rather than nothing. A
// Savannah, GEORGIA rent roll landed in Savannah, Texas and at the geographic
// centre of Texas, about 800 miles out.
//
// The lesson the tests encode: a WRONG state is far worse than no state. So
// the false-positive cases below matter more than the positive ones.
//   node scripts/test-geocode-state.mjs
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const ts = (await import("typescript")).default;
const src = fileURLToPath(new URL("../lib/geocode.ts", import.meta.url));
const tmp = new URL("../lib/.geocode.test.mjs", import.meta.url);
writeFileSync(
  fileURLToPath(tmp),
  ts.transpileModule(readFileSync(src, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
);
const { resolveState, normaliseState, isUsableForDistance } = await import(tmp.href);

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log("== the case that caused this ==");
// Exactly what the Oakbrook rent roll passed: [address, city, market].
eq("Savannah GA from the market field",
  resolveState(["2025 Louisville Rd", "Savannah", "Savannah, GA"]), "GA");
eq("Savannah GA from the address field",
  resolveState(["2025 Louisville Road, Savannah, GA", null, null]), "GA");
eq("spelled out in full",
  resolveState(["2025 Louisville Road, Savannah, Georgia", null, null]), "GA");
// And the Texas comps must still resolve to Texas.
eq("Conroe still TX", resolveState(["2511 North Frazier St", "Conroe", "Houston, TX"]), "TX");

console.log("\n== a wrong state is worse than none ==");
// A street named after a state is not an address in that state. There is a
// "316 Georgia Avenue" in the Houston IOS comp set.
eq("Georgia Avenue is a Houston street", resolveState(["316 Georgia Avenue", "Houston", null]), null);
eq("Washington Blvd is not Washington", resolveState(["1200 Washington Blvd", "Dallas", null]), null);
eq("Indiana Ave is not Indiana", resolveState(["55 Indiana Ave", null, null]), null);
// Two-letter codes hiding inside street names.
eq("LA Salle Dr is not Louisiana", resolveState(["3612 LA Salle Dr", "Fort Worth", null]), null);
eq("lowercase is not a state code", resolveState(["100 Main St, in", null, null]), null);
eq("mixed case is not a state code", resolveState(["100 Main St, Ok", null, null]), null);
// Nothing to go on must stay null, so the lookup runs unrestricted rather
// than being locked to a guess.
eq("no state anywhere", resolveState(["2910 Pasadena Fwy", "Pasadena", "Houston"]), null);
eq("all empty", resolveState([null, undefined, ""]), null);

console.log("\n== precedence ==");
// Callers pass address first and market last; the market is better evidence.
eq("later parts win", resolveState(["1 Main St, TX", "Savannah", "Savannah, GA"]), "GA");
eq("a real code at the end of a long address",
  resolveState(["2025 Louisville Road, Suite B, Savannah, GA"]), "GA");

console.log("\n== normalising what a person typed ==");
eq("bare code", normaliseState("ga"), "GA");
eq("already a code", normaliseState("TX"), "TX");
eq("padded", normaliseState("  Ga  "), "GA");
eq("full name", normaliseState("Georgia"), "GA");
eq("two-word name", normaliseState("new mexico"), "NM");
eq("not a state", normaliseState("Republic of Texas"), null);
eq("empty", normaliseState(""), null);
eq("null", normaliseState(null), null);

console.log("\n== precision is unchanged ==");
// A state centroid is what a wrong administrative_area produces, and it must
// still be refused for distance work.
eq("centroid is not usable for distance", isUsableForDistance("approximate"), false);
eq("rooftop is", isUsableForDistance("rooftop"), true);
eq("coordinates from the source file are trusted", isUsableForDistance("supplied"), true);

unlinkSync(fileURLToPath(tmp));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
