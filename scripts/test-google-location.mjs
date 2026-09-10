import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
const baseline = {
  geometry: { location_type: "ROOFTOP", location: { lat: 29.9, lng: -95.5 } },
  address_components: [
    { types: ["street_number"], long_name: "8615" },
    { types: ["route"], long_name: "Golden Spike Lane" },
    { types: ["locality"], long_name: "Houston" },
  ], formatted_address: "8615 Golden Spike Ln, Houston, TX",
};
let results = [baseline];
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/geocode.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports, URL, AbortSignal, process: { env: { GOOGLE_MAPS_SERVER_KEY: "test" } },
  fetch: async () => ({ json: async () => ({ status: "OK", results }) }),
});
const lookup = (address = "8615 Golden Spike Ln") => exports.geocodeAddress([address, "Houston", "Houston"], { requirePrecise: true });
assert.ok(await lookup());
assert.equal(await lookup("8615 Wrong Street"), null);
assert.equal(await lookup("8616 Golden Spike Ln"), null);
results = [{ ...baseline, partial_match: true }];
assert.equal(await lookup(), null);
results = [{ ...baseline, geometry: { ...baseline.geometry, location_type: "APPROXIMATE" } }];
assert.equal(await lookup(), null);
results = [baseline, baseline];
assert.equal(await lookup(), null);
results = [];
assert.equal(await lookup(), null);
console.log("Google-first checks passed: street aliases, wrong street/number, partial/approximate matches, multiple results and no match.");
