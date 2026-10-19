// scripts/test-split-sites.mjs
//
// Tests lib/split-sites.ts on the multi-site deal addresses actually in Hopper.
//   node scripts/test-split-sites.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/split-sites.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m }
);
let n = 0;
const eq = (a, b, l) => { assert.deepEqual([...a], b, l); n++; };
eq(m.splitSites("Gateway 190 Portfolio (1601 E Plano Pky + 4009 Distribution Dr + 3801 Regency Crest Dr)"), ["1601 E Plano Pky", "4009 Distribution Dr", "3801 Regency Crest Dr"], "bracketed list");
eq(m.splitSites("1330, 1600 & 1720 S Jupiter Rd"), ["1330 S Jupiter Rd", "1600 S Jupiter Rd", "1720 S Jupiter Rd"], "numbers sharing a street");
eq(m.splitSites("3918 & 3920 E Jefferson St + 3955 E Main St"), ["3918 E Jefferson St", "3920 E Jefferson St", "3955 E Main St"], "mixed");
eq(m.splitSites("1164 Jordan Ranch Blvd / 4008 Heritage Dr / 4006 Westport Dr"), ["1164 Jordan Ranch Blvd", "4008 Heritage Dr", "4006 Westport Dr"], "slashes");
eq(m.splitSites("Project Frontera Portfolio (11891-11901 Alameda Ave + 1340 Bob Hope Dr)"), ["11891-11901 Alameda Ave", "1340 Bob Hope Dr"], "range kept as one site");
eq(m.splitSites("Port America Portfolio (15 Buildings)"), [], "count only: nothing to split");
eq(m.splitSites("9000 Clay Rd & 9009 Pinehill Ln"), ["9000 Clay Rd", "9009 Pinehill Ln"], "two full addresses with &");
assert.equal(m.portfolioName("Gateway 190 Portfolio (1601 E Plano Pky + 4009 Distribution Dr)", []), "Gateway 190 Portfolio"); n++;
assert.equal(m.portfolioName("1330, 1600 & 1720 S Jupiter Rd", ["1330 S Jupiter Rd"]), "1330 S Jupiter Rd portfolio"); n++;
assert.equal(m.looksMultiSite("1330, 1600 & 1720 S Jupiter Rd"), true); n++;
assert.equal(m.looksMultiSite("4719 Broom St"), false); n++;
assert.equal(m.looksMultiSite("5711-5718 Navigation Blvd"), false, "a number range is one site"); n++;
console.log(`split-sites: ${n} checks passed`);
