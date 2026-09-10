import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (name) => dependencies[name] });
  return exports;
}
let authenticated = true, found = true, updated;
const db = { from: (table) => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: found ? { property_id: "property" } : null, error: null }) }) }),
  update: (value) => { updated = { table, value }; return { eq: (_, id) => {
    assert.equal(id, "property");
    return { select: () => ({ maybeSingle: async () => ({ data: { id, ...value }, error: null }) }) };
  } }; },
}) };
const route = load("../app/api/deals/[id]/location/route.ts", {
  "@/lib/comps/mapData": load("../lib/comps/mapData.ts"),
  "@/lib/auth": { getCurrentUser: async () => authenticated ? { email: "test@example.com" } : null },
  "@/lib/supabase": { getServiceClient: () => db },
  "next/server": { NextResponse: { json: (body, opts) => ({ body, status: opts?.status ?? 200 }) } },
});
const call = (body) => route.PATCH({ json: async () => body }, { params: { id: "deal" } });
for (const body of [null, {}, { latitude: " ", longitude: -95 }, { latitude: true, longitude: -95 },
  { latitude: 91, longitude: -95 }, { latitude: 30, longitude: 181 }, { latitude: "NaN", longitude: -95 }]) {
  assert.equal((await call(body)).status, 400);
}
assert.equal(updated, undefined);
assert.equal((await call({ latitude: "30.25", longitude: "-95.5" })).status, 200);
assert.equal(updated.table, "properties");
assert.equal(updated.value.latitude, 30.25);
assert.equal(updated.value.geocode_precision, "manual");
assert.equal("address" in updated.value, false);
assert.equal("building_sf" in updated.value, false);
found = false;
assert.equal((await call({ latitude: 30, longitude: -95 })).status, 404);
authenticated = false;
assert.equal((await call({ latitude: 30, longitude: -95 })).status, 401);
console.log("Deal location checks passed: auth, missing property, coordinate validation, manual precision, and isolated property updates.");
