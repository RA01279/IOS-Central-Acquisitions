// scripts/test-om-comps.mjs
//
// Tests lib/om-comps.ts: picking an OM's comparables pages (plus the page
// after each) and nothing else.
//   node scripts/test-om-comps.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/om-comps.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m }
);
const om = [
  "\n[Page 1] Offering Memorandum 123 Main St",
  "\n[Page 2] Rent roll: Tenant A $12,000/mo",
  "\n[Page 3] Lease Comparables 10 Oak Rd $9,500/AC/mo",
  "\n[Page 4] 22 Elm St $8,900/AC/mo (continued table)",
  "\n[Page 5] Pro forma cash flow",
  "\n[Page 6] Sale Comps 5 Pine Ave sold $1.2M/AC",
].join("");
const p = m.compPages(om);
assert.deepEqual([...p.pages], [3, 4, 6], "comp pages and the page after each");
assert.ok(!/Rent roll|Pro forma/.test(p.text), "subject pages left out");
assert.ok(p.text.startsWith("[Page 3]"), "page markers kept");
assert.equal(m.compPages("\n[Page 1] Property overview\n[Page 2] Site plan").found, false, "no comp pages");
assert.equal(m.splitPages(om).length, 6);
assert.equal(m.OM_COMP_PAGE.test("Recent Transactions in the submarket"), true);
assert.equal(m.OM_COMP_PAGE.test("Competitive advantages"), false, "'comp' inside a word doesn't count");
console.log("om-comps: 7 checks passed");
