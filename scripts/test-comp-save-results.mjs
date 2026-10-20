import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
function load(path, dependencies = {}) {
  const loaded = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: loaded, require: name => dependencies[name] });
  return loaded;
}
let calls = 0;
const match = load("../lib/comps/match.ts");
const dependencies = {
  "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
  "@/lib/auth": { getCurrentUser: async () => ({ email: "test@example.com" }) },
  "@/lib/locate-site": { locateMany: async (rows) => rows.map(() => ({ found: false, reason: "Only a partial match: East Dr, Texas 77302, USA." })) },
  "@/lib/location": load("../lib/location.ts"),
  "@/lib/money": load("../lib/money.ts"),
  "@/lib/markets": load("../lib/markets.ts"),
  "@/lib/comps/cache": { invalidateComps: () => {} },
  "@/lib/comps/intake-validation": load("../lib/comps/intake-validation.ts", { "../stage-rules": load("../lib/stage-rules.ts") }),
  "@/lib/comps/match": match,
  "@/lib/comps/review": load("../lib/comps/review.ts", { "./match": match }),
  "@/lib/comps/mapData": load("../lib/comps/mapData.ts"),
  "@/lib/supabase": { getServiceClient: () => ({ from: () => ({
    // The review checks read the repository first; it's empty here.
    select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }),
    insert: (rows) => ({
      select: async () => {
        calls++;
        if (Array.isArray(rows) || rows.address === "Duplicate") return { data: null, error: { code: "23505" } };
        return { data: [{ id: rows.address, ...rows }], error: null };
      },
    }),
  }) }) },
};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL("../app/api/comps/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText, { exports, require: (name) => dependencies[name] });
const response = await exports.POST({ json: async () => ({ comps: [
  { _key: "lease", assetClass: "ios", address: "Austin yard", compType: "lease", rent: 4000, rentBasis: "per_acre_monthly", dateCommenced: "2026-09-01", latitude: 30.26, longitude: -97.74 },
  { _key: "sale", assetClass: "industrial", address: "Austin sale", compType: "sale", salePrice: "$4.2M", closedOn: "2026-09-01", latitude: 30.26, longitude: -97.74 },
  { _key: "duplicate", assetClass: "ios", address: "Duplicate", compType: "lease", rent: 4000, rentBasis: "per_acre_monthly", dateCommenced: "2026-09-01", latitude: 30.26, longitude: -97.74 },
  { _key: "unlocated", assetClass: "ios", address: "Unknown yard", compType: "lease", rent: 4000, rentBasis: "per_acre_monthly", dateCommenced: "2026-09-01" },
  { _key: "invalid", assetClass: "ios", address: "Bad date", compType: "lease", rent: 4000, rentBasis: "per_acre_monthly", dateCommenced: "2026-02-30" },
] }) });
assert.equal(response.body.saved, 2);
assert.equal(response.body.duplicates, 1);
assert.equal(response.body.savedComps.length, 2);
assert.equal(response.body.savedComps[0].id, "Austin yard");
assert.equal(response.body.geocoding.failed, 0, "Unlocated records must not save");
assert.equal(response.body.geocoding.fromFile, 2);
assert.equal(response.body.rejected.length, 2);
assert.match(response.body.rejected.find((r) => r.address === "Unknown yard").reason, /^Needs manual fix: Only a partial match: East Dr, Texas 77302, USA\. Correct the address/, "an unlocated comp says why");
assert.equal(response.body.savedComps[1].sale_price, 4200000);
assert.equal(JSON.stringify(response.body.completedKeys), JSON.stringify(["lease","sale","duplicate"]));
assert.equal(calls, 4);
console.log("Comp save regression checks passed: lease/sale batch fallback, saved record links, duplicate exclusion and location totals.");
