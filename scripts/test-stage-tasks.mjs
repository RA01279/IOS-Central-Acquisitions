// scripts/test-stage-tasks.mjs
//
// Tests lib/stage-tasks.ts: the checklist a stage adds, and duplicate skipping.
//   node scripts/test-stage-tasks.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/stage-tasks.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m, Date }
);

const psa = m.tasksForStage("moving_to_psa", "2026-10-16", []);
assert.equal(psa.length, 5);
assert.equal(psa.find((t) => t.title === "Order title commitment").due_date, "2026-10-19");
const again = m.tasksForStage("moving_to_psa", "2026-10-16", ["order title commitment ", "Send the PSA draft to counsel"]);
assert.equal(again.length, 3, "open titles are skipped, case and spacing aside");
assert.equal(m.tasksForStage("prospect", "2026-10-16", []).length, 0, "no checklist for prospect");
assert.ok(m.tasksForStage("closed", "2026-12-30", []).every((t) => /^2027-01-0\d$/.test(t.due_date)), "due dates roll over the year");
console.log("stage-tasks: 5 checks passed");
