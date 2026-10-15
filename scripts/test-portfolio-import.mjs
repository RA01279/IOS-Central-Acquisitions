// scripts/test-portfolio-import.mjs
//
// Tests lib/agents/portfolio-import.ts: parsing, merging sections, splitting OM text.
//   node scripts/test-portfolio-import.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const loaded = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/agents/portfolio-import.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: loaded }
);
const { parsePortfolioImport, mergePortfolioImports, splitOmText, siteKey } = loaded;

let n = 0;
const check = (label, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${label}`); throw e; } };

const report = (sites, portfolio = {}) => JSON.stringify({ portfolio, sites, notes: [] });

check("parses sites and drops ones without an address", () => {
  const r = parsePortfolioImport(report([{ address: "100 Main St", city: "Dallas", state: "tx", acres: 4.2, askingPrice: 3500000, assetClass: "ios", page: 12 }, { city: "Nowhere" }]));
  assert.equal(r.sites.length, 1);
  assert.equal(r.sites[0].state, "TX");
  assert.equal(r.sites[0].askingPrice, 3500000);
  assert.equal(r.sites[0].page, 12);
});
check("rejects junk", () => { assert.equal(parsePortfolioImport("not json"), null); assert.equal(parsePortfolioImport("{}"), null); });
check("accepts a code-fenced report", () => assert.equal(parsePortfolioImport("```json\n" + report([{ address: "1 A St" }]) + "\n```").sites.length, 1));
check("bad enums and negative numbers become null", () => {
  const s = parsePortfolioImport(report([{ address: "1 A St", assetClass: "retail", acres: -3, occupancy: "full" }])).sites[0];
  assert.equal(s.assetClass, null); assert.equal(s.acres, null); assert.equal(s.occupancy, null);
});
check("same site in two sections merges, first-stated wins", () => {
  const a = parsePortfolioImport(report([{ address: "100 Main Street", city: "Dallas", acres: 4 }], { name: "Project Atlas" }));
  const b = parsePortfolioImport(report([{ address: "100 Main St.", city: "Dallas", acres: 5, askingPrice: 2000000 }, { address: "9 Oak Rd", city: "Phoenix" }], { name: "Other", totalPrice: 9e6 }));
  const m = mergePortfolioImports([a, b]);
  assert.equal(m.sites.length, 2);
  assert.equal(m.sites[0].acres, 4);
  assert.equal(m.sites[0].askingPrice, 2000000);
  assert.equal(m.portfolio.name, "Project Atlas");
  assert.equal(m.portfolio.totalPrice, 9e6);
});
check("same street in different cities stays two sites", () =>
  assert.notEqual(siteKey({ address: "100 Main St", city: "Dallas" }), siteKey({ address: "100 Main St", city: "Tulsa" })));
check("splits only at page markers", () => {
  const text = Array.from({ length: 10 }, (_, i) => `\n[Page ${i + 1}] ` + "x".repeat(30)).join("");
  const parts = splitOmText(text, 100);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), text);
  for (const p of parts) assert.match(p, /^\n\[Page \d+\] /);
});
check("an oversized page is cut, not dropped", () => {
  const parts = splitOmText("\n[Page 1] " + "y".repeat(500), 100);
  assert.equal(parts.length, 1); assert.equal(parts[0].length, 100);
});

console.log(`${n} checks passed`);
