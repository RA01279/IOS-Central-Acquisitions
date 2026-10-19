// scripts/test-firm-guess.mjs
//
// Tests lib/firm-guess.ts on the shapes broker contacts actually take.
//   node scripts/test-firm-guess.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/firm-guess.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m }
);
const companies = [{ id: "s", name: "Stream Realty Partners" }, { id: "a", name: "Alpine Partners" }, { id: "p", name: "Partners Real Estate" }, { id: "c", name: "Colliers (Houston)" }];
const g = (name, email) => m.guessFirm({ name, email }, companies);
let n = 0;
const eq = (a, b, l) => { assert.deepEqual(a, b, l); n++; };
eq(g("Andres Aiza, Alpine Partners")?.companyId, "a", "existing firm after a comma");
eq(g("Devon G (Stream Realty Partners)")?.companyId, "s", "existing firm in brackets");
eq(g("Joe Smith (Stream Realty)")?.companyId, "s", "short form of an existing firm");
eq(g("Stephen Bailey (Newmark)")?.name, "Newmark", "new firm in brackets");
eq(g("Stephen Bailey (Newmark)")?.companyId, null);
eq(g("Mike T — Caldwell Land Co")?.name, "Caldwell Land Co", "firm after a dash");
eq(g("Todd Hubbard, SIOR"), null, "a designation isn't a firm");
eq(g("Ben Siegel / Ethan Silverman"), null, "two people aren't a firm");
eq(g("Chase Miller", "cmiller@cbre.com")?.name, "CBRE", "email domain");
eq(g("Chase Miller", "chase@gmail.com"), null, "personal email says nothing");
eq(g("Dustin Volz (dustin.volz@nmrk.com, 972.322.5671)")?.name, "Newmark", "email pasted into the name");
eq(g("Kim Lee, Colliers")?.companyId, "c", "existing firm with a bracketed suffix");
eq(m.tidyFirm("Dry Water Land Company, LLC,, "), "Dry Water Land Company", "legal suffix and stray commas");
eq(m.tidyFirm("JLL Capital Markets, +, (also Charles Strauss, Lance Young)"), "JLL", "brand, bracket note and '+' removed");
eq(m.tidyFirm("CBRE, Inc."), "CBRE", "one CBRE");
eq(m.tidyFirm("Rich Young Co."), "Rich Young Co.", "'Co.' is part of the name");
eq(g("Alex Perry, SIOR — Dry Water Land Company, LLC, 214.733.6141")?.name, "Dry Water Land Company", "firm after a dash with phone");
console.log(`firm-guess: ${n} checks passed`);
