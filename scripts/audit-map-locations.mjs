// Read-only by default. --lookup proposes exact matches; --apply writes only
// those matches, with a comparison against the original address and coordinates.
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
nextEnv.loadEnvConfig(process.cwd());
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
function moduleAt(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, process, fetch, URL, AbortSignal });
  return exports;
}
const { locationReady, parseCoordinatePair } = moduleAt("lib/location.ts");
const { geocodeAddress } = moduleAt("lib/geocode.ts");
async function all(table, columns) {
  const rows = [];
  for (;;) {
    const { data, error } = await db.from(table).select(columns).order("id").range(rows.length, rows.length + 499);
    if (error) throw new Error(error.message);
    if (!data.length) return rows;
    rows.push(...data);
  }
}
const deals = await all("deals", "id,property_id,stage");
const report = { generatedAt: new Date().toISOString(), applied: process.argv.includes("--apply"), summary: {}, unresolved: [], repaired: [] };
for (const table of ["properties", "comps"]) {
  const rows = await all(table, table === "comps" ? "id,address,city,state,market,latitude,longitude,geocode_precision,comp_type" : "id,address,city,market,latitude,longitude,geocode_precision");
  const targets = rows.filter(row => !locationReady(row));
  const counts = { total: rows.length, mapReady: rows.length - targets.length, needsLocation: targets.length, matched: 0, saved: 0 };
  report.summary[table] = counts;
  for (const row of targets) {
    const linkedDeals = table === "properties" ? deals.filter(d => d.property_id === row.id) : [];
    const entry = { table, ...row, deals: linkedDeals };
    let point = null;
    if (process.argv.includes("--lookup") || report.applied) {
      const pair = parseCoordinatePair(row.address ?? "");
      if (pair) point = { ...pair, geocode_precision: "supplied", formatted: row.address };
      else {
        const g = await geocodeAddress([row.address, row.city, row.market], { state: row.state, requirePrecise: true });
        if (g) point = { latitude: g.lat, longitude: g.lng, geocode_precision: g.precision, formatted: g.formatted };
      }
    }
    if (!point) { report.unresolved.push(entry); continue; }
    counts.matched++;
    if (report.applied) {
      let query = db.from(table).update({ latitude: point.latitude, longitude: point.longitude, geocode_precision: point.geocode_precision, geocoded_at: new Date().toISOString() }).eq("id", row.id);
      for (const key of ["address", "city", "market", "latitude", "longitude", "geocode_precision", ...(table === "comps" ? ["state"] : [])]) query = row[key] == null ? query.is(key, null) : query.eq(key, row[key]);
      const { data, error } = await query.select("id");
      if (error) throw new Error(error.message);
      if (data.length !== 1) throw new Error(`Concurrent edit: ${table}/${row.id}; stopped without overwriting it`);
      counts.saved++;
    }
    report.repaired.push({ ...entry, proposed: point });
  }
}
const unresolvedProperties = new Set(report.unresolved.filter(r => r.table === "properties").map(r => r.id));
report.summary.deals = { total: deals.length, needsLocation: deals.filter(d => unresolvedProperties.has(d.property_id)).length, activeNeedsLocation: deals.filter(d => !["closed", "archived"].includes(d.stage) && unresolvedProperties.has(d.property_id)).length };
writeFileSync("docs/map-location-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
console.log("Unresolved:", JSON.stringify(report.unresolved.map(r => ({ table: r.table, address: r.address, city: r.city, market: r.market, state: r.state, precision: r.geocode_precision, deals: r.deals.map(d => d.stage) })), null, 2));
