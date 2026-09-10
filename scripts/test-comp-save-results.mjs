import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
let calls = 0;
const dependencies = {
  "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
  "@/lib/auth": { getCurrentUser: async () => ({ email: "test@example.com" }) },
  "@/lib/geocode": { geocodeMany: async (rows) => rows.map(() => null) },
  "@/lib/supabase": { getServiceClient: () => ({ from: () => ({ insert: (rows) => ({
    select: async () => {
      calls++;
      if (Array.isArray(rows) || rows.address === "Duplicate") return { data: null, error: { code: "23505" } };
      return { data: [{ id: rows.address, ...rows }], error: null };
    },
  }) }) }) },
};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL("../app/api/comps/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText, { exports, require: (name) => dependencies[name] });
const response = await exports.POST({ json: async () => ({ comps: [
  { address: "Austin yard", compType: "lease", rent: 4000, rentBasis: "per_acre_monthly", dateCommenced: "2026-09-01" },
  { address: "Austin sale", compType: "sale", salePrice: 1000000, closedOn: "2026-09-01", latitude: 30.26, longitude: -97.74 },
  { address: "Duplicate", compType: "lease", rent: 4000, rentBasis: "per_acre_monthly", dateCommenced: "2026-09-01" },
] }) });
assert.equal(response.body.saved, 2);
assert.equal(response.body.duplicates, 1);
assert.equal(response.body.savedComps.length, 2);
assert.equal(response.body.savedComps[0].id, "Austin yard");
assert.equal(response.body.geocoding.failed, 1, "Duplicate geocoding failures must not count as newly saved problems");
assert.equal(response.body.geocoding.fromFile, 1);
assert.equal(calls, 4);
console.log("Comp save regression checks passed: lease/sale batch fallback, saved record links, duplicate exclusion and location totals.");
