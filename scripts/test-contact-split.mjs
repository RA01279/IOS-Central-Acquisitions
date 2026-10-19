// scripts/test-contact-split.mjs
//
// Tests lib/contact-split.ts on the broker-team "contacts" actually in Hopper.
//   node scripts/test-contact-split.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (path, deps = {}) => {
  const m = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports: m, require: (n) => deps[n] }
  );
  return m;
};
const fg = load("../lib/firm-guess.ts");
const m = load("../lib/contact-split.ts", { "./firm-guess": fg });
let n = 0;
const check = (raw, firm, people) => {
  const r = m.splitContact(raw);
  assert.equal(r.firm, firm, `${raw}: firm`);
  assert.deepEqual([...r.people].map((p) => [p.name, p.email, p.phone]), people, `${raw}: people`);
  n++;
};
check("Stephen Bailey / Dustin Volz (Newmark)", "Newmark", [["Stephen Bailey", null, null], ["Dustin Volz", null, null]]);
check("JLL (Mark Nicholas / Angela Watford / Martin Gutierrez)", "JLL", [["Mark Nicholas", null, null], ["Angela Watford", null, null], ["Martin Gutierrez", null, null]]);
check(
  "Ahmed Omar (Broker), M 214.491.8068, ahmed@go-regroup.com; Burhaan Nadeem (Agent), M 909.358.7635, burhaan@go-regroup.com — GO Real Estate Group",
  "GO Real Estate Group",
  [["Ahmed Omar", "ahmed@go-regroup.com", "214.491.8068"], ["Burhaan Nadeem", "burhaan@go-regroup.com", "909.358.7635"]]
);
check(
  "Matthew Seymour (281.664.6742, MSeymour@CaldwellCos.com); Mark Terpstra (281.664.6634, MTerpstra@CaldwellCos.com) — Caldwell Land Co",
  "Caldwell Land Co",
  [["Matthew Seymour", "MSeymour@CaldwellCos.com", "281.664.6742"], ["Mark Terpstra", "MTerpstra@CaldwellCos.com", "281.664.6634"]]
);
check(
  "Trent Agnew — JLL Capital Markets, +1 713 852 3431, trent.agnew@jll.com (also Charles Strauss, Lance Young)",
  "JLL",
  [["Trent Agnew", "trent.agnew@jll.com", "+1 713 852 3431"], ["Charles Strauss", null, null], ["Lance Young", null, null]]
);
check("Nathan Wynne / CBRE National Partners; Bill Caparis (local)", "CBRE", [["Nathan Wynne", null, null], ["Bill Caparis", null, null]]);
check(
  "Brian Fiumara, Zach Graham, Nathan Wynne, Elliott Dow and George Fallon — CBRE, Inc.",
  "CBRE",
  [["Brian Fiumara", null, null], ["Zach Graham", null, null], ["Nathan Wynne", null, null], ["Elliott Dow", null, null], ["George Fallon", null, null]]
);
check("Andres Aiza, Alpine Partners", "Alpine Partners", [["Andres Aiza", null, null]]);
check("N/A", null, []);
console.log(`contact-split: ${n} checks passed`);
