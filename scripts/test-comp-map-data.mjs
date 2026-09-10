import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL("../lib/comps/mapData.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText, { exports });
const { hasMapCoordinates, readAllCompPages } = exports;
const records = Array.from({ length: 1203 }, (_, id) => ({
  id, latitude: id < 3 ? null : 30.2672, longitude: id < 3 ? null : -97.7431,
}));
// Simulate a database cap lower than the requested 500 rows.
const all = await readAllCompPages(async (from, to) => ({
  data: records.slice(from, Math.min(to + 1, from + 200)), error: null,
}));
assert.equal(all.length, 1203);
assert.equal(new Set(all.map((r) => r.id)).size, 1203);
assert.equal(all.filter((r) => !hasMapCoordinates(r)).length, 3);
assert.equal(all.filter(hasMapCoordinates).length, 1200);
for (const value of [null, undefined, "", NaN, Infinity, 91]) {
  assert.equal(hasMapCoordinates({ latitude: value, longitude: -97 }), false);
}
assert.equal(hasMapCoordinates({ latitude: "30.2672", longitude: "-97.7431" }), true);
assert.equal(hasMapCoordinates({ latitude: 30, longitude: 181 }), false);
assert.equal((await readAllCompPages(async () => ({ data: [], error: null }))).length, 0);
await assert.rejects(readAllCompPages(async () => ({ data: null, error: { message: "Unavailable" } })), /Unavailable/);
console.log("Comp map regression checks passed: pagination beyond 1,000, short database pages, missing/invalid coordinates, and query failures.");
