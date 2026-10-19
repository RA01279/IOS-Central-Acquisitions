// scripts/test-activity-buckets.mjs
//
// Tests lib/activity-buckets.ts: Monday weeks, calendar months, class split,
// the prior window.
//   node scripts/test-activity-buckets.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const m = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL("../lib/activity-buckets.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  { exports: m, Date }
);
let n = 0;
const eq = (a, b, l) => { assert.deepEqual(a, b, l); n++; };
eq(m.weekStart("2026-10-19"), "2026-10-19", "Monday is its own week start");
eq(m.weekStart("2026-10-25"), "2026-10-19", "Sunday belongs to the week before");
const w = m.emptyBuckets("week", "2026-10-21");
eq(w.length, 12);
eq(w[11].start, "2026-10-19", "last bucket is this week");
eq(w[0].start, "2026-08-03", "eleven weeks back");
eq(w[11].label, "Oct 19");
const mo = m.emptyBuckets("month", "2026-10-21");
eq([mo[0].start, mo[11].start, mo[11].end], ["2025-11-01", "2026-10-01", "2026-10-31"], "calendar months");
eq(mo[2].label, "Jan ’26", "January shows the year");
const pts = [
  { date: "2026-10-19", amount: 1000000, cls: "ios" },
  { date: "2026-10-20", amount: 2500000, cls: "industrial" },
  { date: "2026-10-12", amount: 500000, cls: "ios" },
  { date: "2025-01-01", amount: 9, cls: "ios" },
];
const b = m.bucketize(pts, "week", "2026-10-21");
eq([b[11].ios.count, b[11].industrial.count, b[11].industrial.amount, b[10].ios.count], [1, 1, 2500000, 1], "split by class and week");
eq(b.reduce((t, x) => t + x.ios.count + x.industrial.count, 0), 3, "out-of-window ignored");
const prior = m.priorWindow([{ date: "2026-07-27", cls: "ios" }, ...pts], "week", "2026-10-21");
eq(prior[11].start, "2026-07-27", "prior window ends the week before this one starts");
eq(prior[11].ios.count, 1);
console.log(`activity-buckets: ${n} checks passed`);
