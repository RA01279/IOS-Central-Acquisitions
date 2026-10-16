// scripts/test-diligence.mjs
//
// Tests lib/diligence.ts: day parsing from LOI terms and the schedule template.
//   node scripts/test-diligence.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const d = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/diligence.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: d, Date }
);

let n = 0;
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); n++; };

check("Sixty (60)", d.parseDays("Sixty (60)"), 60);
check("thirty (30)", d.parseDays("thirty (30)"), 30);
check("Forty-Five (45)", d.parseDays("Forty-Five (45)"), 45);
check("bare 45", d.parseDays("45"), 45);
check("word only", d.parseDays("forty-five"), 45);
check("number", d.parseDays(21), 21);
check("blank", d.parseDays(""), null);
check("junk", d.parseDays("TBD"), null);

const s = d.buildSchedule({ psaEffectiveOn: "2026-11-02", ddDays: 60, closingDays: 30, occupied: false });
const at = (k) => s.find((r) => r.key === k)?.due_on;
check("PSA effective", at("psa_effective"), "2026-11-02");
check("deposit +3", at("deposit"), "2026-11-05");
check("title +15", at("title_commitment"), "2026-11-17");
check("survey +30", at("survey"), "2026-12-02");
check("DD end +60", at("dd_end"), "2027-01-01");
check("objections 15 before DD end", at("title_objections"), "2026-12-17");
check("Phase II 10 before", at("phase2"), "2026-12-22");
check("extension 3 before", at("extension"), "2026-12-29");
check("closing 30 after DD", at("closing"), "2027-01-31");
check("no estoppels when vacant", at("estoppels"), undefined);
check("estoppels when occupied", d.buildSchedule({ psaEffectiveOn: "2026-11-02", ddDays: 60, occupied: true }).find((r) => r.key === "estoppels")?.due_on, "2026-12-27");
check("defaults 60 / 30", d.buildSchedule({ psaEffectiveOn: "2026-11-02" }).find((r) => r.key === "closing")?.due_on, "2027-01-31");

// A 20-day DD: early items can't land after DD ends.
const short = d.buildSchedule({ psaEffectiveOn: "2026-11-02", ddDays: 20 });
const sAt = (k) => short.find((r) => r.key === k)?.due_on;
check("short DD: survey pulled before DD end", sAt("survey"), "2026-11-21");
check("short DD: DD end", sAt("dd_end"), "2026-11-22");
check("short DD: every date on or before DD end except closing", short.filter((r) => r.key !== "closing").every((r) => r.due_on <= "2026-11-22"), true);
check("keys unique", new Set(s.map((r) => r.key)).size, s.length);

const due = d.dueSoon(
  [
    { due_on: "2026-11-01", done_on: null, id: 1 },
    { due_on: "2026-11-04", done_on: null, id: 2 },
    { due_on: "2026-11-20", done_on: null, id: 3 },
    { due_on: "2026-11-03", done_on: "2026-11-02", id: 4 },
    { due_on: null, done_on: null, id: 5 },
  ],
  "2026-11-02"
).map((r) => r.id);
check("due soon: overdue and within 7 days, open only", due, [1, 2]);

console.log(`diligence: ${n} checks passed`);
