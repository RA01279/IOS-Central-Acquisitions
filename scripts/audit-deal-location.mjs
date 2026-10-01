import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
nextEnv.loadEnvConfig(process.cwd());
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await db.from("properties").select("id,address,city,market,latitude,longitude,geocode_precision")
  .ilike("address", "%Golden Spike%");
if (error) throw new Error(error.message);
console.log(JSON.stringify(data, null, 2));
for (const property of data ?? []) {
  const { data: deals } = await db.from("deals").select("id,stage,asset_class").eq("property_id", property.id);
  console.log("Deals:", JSON.stringify(deals));
  if (!process.argv.includes("--lookup")) continue;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/geocode.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, process, fetch, URL, AbortSignal });
  const location = await exports.geocodeAddress([property.address, property.city, property.market], { requirePrecise: true });
  console.log("Confident Google match:", JSON.stringify(location));
  if (location && process.argv.includes("--apply") && property.latitude == null && property.longitude == null) {
    const { data: saved, error: updateError } = await db.from("properties").update({
      latitude: location.lat, longitude: location.lng, geocode_precision: location.precision, geocoded_at: new Date().toISOString(),
    }).eq("id", property.id).is("latitude", null).is("longitude", null).select("address,latitude,longitude,geocode_precision");
    if (updateError) throw new Error(updateError.message);
    console.log("Saved:", JSON.stringify(saved));
  }
}
