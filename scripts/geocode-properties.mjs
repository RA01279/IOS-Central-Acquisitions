// scripts/geocode-properties.mjs
//
// Resolves and caches coordinates for property addresses, so comp matching can
// score by real distance. Nothing had coordinates before this (0 of 471), which
// is why comp distance scoring was impossible and the demand map re-geocoded on
// every single call.
//
//   node scripts/geocode-properties.mjs               # geocode everything missing
//   node scripts/geocode-properties.mjs --limit 20    # try a small batch first
//   node scripts/geocode-properties.mjs --dry-run     # resolve but write nothing
//   node scripts/geocode-properties.mjs --table comps # comps instead of properties
//
// Safe to re-run: it only touches rows with no latitude, so an interrupted run
// resumes where it stopped. To re-geocode a corrected address, null out that
// row's latitude first.
//
// A word on precision: Google's geocoder always answers. For an address it
// can't find it returns the city or ZIP centroid, flagged APPROXIMATE. Those
// are stored WITH that flag rather than silently, because a centroid makes a
// comp two miles away look adjacent -- the matcher refuses to use them, and
// this script lists them so the addresses can be fixed.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""),
      l.slice(l.indexOf("=") + 1).trim(),
    ])
);

const KEY = env.GOOGLE_MAPS_SERVER_KEY;
if (!KEY) {
  console.error("GOOGLE_MAPS_SERVER_KEY missing from .env.local");
  process.exit(1);
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : null;
const tableIdx = args.indexOf("--table");
const table = tableIdx !== -1 ? args[tableIdx + 1] : "properties";
if (!["properties", "comps"].includes(table)) {
  console.error(`--table must be "properties" or "comps"`);
  process.exit(1);
}

const PRECISION = {
  ROOFTOP: "rooftop",
  RANGE_INTERPOLATED: "range_interpolated",
  GEOMETRIC_CENTER: "geometric_center",
  APPROXIMATE: "approximate",
};

// Some rows have a coordinate pair pasted into the address field instead of an
// address ("30.4717920, -97.6650795") -- someone dropped a pin and copied it.
// The geocoder can only resolve those to a city centroid, yet the row is
// carrying perfectly good coordinates already, just in the wrong column. Parse
// them rather than throwing away the one precise thing about the record.
//
// Bounds-checked against Texas so a street number can't be mistaken for a
// latitude, and a bare single number is rejected -- there are rows holding only
// a latitude, which is not a location.
function coordinatesFromAddress(address) {
  const m = String(address ?? "").match(/^\s*(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < 25.5 || lat > 37 || lng < -107 || lng > -93) return null; // not Texas
  return { lat, lng };
}

// Repair pass for the above. Targets rows the geocoder could only place at a
// centroid, so it can't overwrite a good result.
if (args.includes("--fix-coordinate-addresses")) {
  const { data: suspects, error: sErr } = await supabase
    .from(table)
    .select("id, address")
    .eq("geocode_precision", "approximate");
  if (sErr) {
    console.error(`Could not read ${table}: ${sErr.message}`);
    process.exit(1);
  }
  let fixed = 0;
  const unfixable = [];
  for (const row of suspects ?? []) {
    const coords = coordinatesFromAddress(row.address);
    if (!coords) {
      unfixable.push(row.address);
      continue;
    }
    if (!dryRun) {
      const { error: upErr } = await supabase
        .from(table)
        .update({
          latitude: coords.lat,
          longitude: coords.lng,
          // A dropped pin is precise about the site even though it tells us
          // nothing about the parcel, so this sits below rooftop.
          geocode_precision: "geometric_center",
          geocoded_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (upErr) unfixable.push(`${row.address} [write failed]`);
      else fixed++;
    } else {
      fixed++;
    }
  }
  console.log(`${fixed} rows recovered from coordinate-shaped addresses${dryRun ? " (dry run)" : ""}`);
  console.log(`${unfixable.length} still only resolve to a centroid and need a real address:`);
  unfixable.slice(0, 25).forEach((a) => console.log(`  ${a}`));
  process.exit(0);
}

let query = supabase
  .from(table)
  .select("id, address, city, market")
  .is("latitude", null)
  .not("address", "is", null)
  .order("created_at", { ascending: true });
if (limit) query = query.limit(limit);

const { data: rows, error } = await query;
if (error) {
  console.error(`Could not read ${table}: ${error.message}`);
  process.exit(1);
}
console.log(`${rows.length} ${table} rows missing coordinates${dryRun ? "  (dry run)" : ""}`);
if (!rows.length) process.exit(0);
console.log(`estimated cost: $${((rows.length / 1000) * 5).toFixed(2)} at $5/1000 geocodes\n`);

async function geocode(row) {
  // City and state narrow it: "1000 Rankin Rd" alone is ambiguous across Texas,
  // let alone the country. `market` is a fallback because it often holds a city
  // name in this data ("La Porte", "Round Rock") rather than a metro.
  const parts = [row.address, row.city || row.market, "TX"].filter(Boolean);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", parts.join(", "));
  url.searchParams.set("components", "country:US|administrative_area:TX");
  url.searchParams.set("key", KEY);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status === "OVER_QUERY_LIMIT") throw new Error("OVER_QUERY_LIMIT");
  if (data.status !== "OK" || !data.results?.length) return { status: data.status };
  const best = data.results[0];
  return {
    status: "OK",
    lat: best.geometry.location.lat,
    lng: best.geometry.location.lng,
    precision: PRECISION[best.geometry.location_type] ?? "approximate",
    formatted: best.formatted_address,
  };
}

const counts = { rooftop: 0, range_interpolated: 0, geometric_center: 0, approximate: 0 };
const failures = [];
const approximates = [];
let done = 0;

// Sequential on purpose: geocoding is billed per call and rate-limited, and a
// 471-row backfill finishing a few seconds sooner is worth nothing next to not
// tripping OVER_QUERY_LIMIT halfway through.
for (const row of rows) {
  let result;
  try {
    result = await geocode(row);
  } catch (err) {
    console.error(`\nStopping: ${err.message} after ${done} rows. Re-run to resume.`);
    break;
  }

  if (result.status !== "OK") {
    failures.push(`${row.address} [${result.status}]`);
  } else {
    counts[result.precision]++;
    if (result.precision === "approximate") approximates.push(`${row.address} -> ${result.formatted}`);
    if (!dryRun) {
      const { error: upErr } = await supabase
        .from(table)
        .update({
          latitude: result.lat,
          longitude: result.lng,
          geocode_precision: result.precision,
          geocoded_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (upErr) failures.push(`${row.address} [write failed: ${upErr.message}]`);
    }
  }

  done++;
  if (done % 25 === 0) process.stdout.write(`  ${done}/${rows.length}\r`);
}

const usable = counts.rooftop + counts.range_interpolated + counts.geometric_center;
console.log(`\nprocessed ${done} rows`);
console.log(`  rooftop            ${counts.rooftop}`);
console.log(`  range interpolated ${counts.range_interpolated}`);
console.log(`  geometric center   ${counts.geometric_center}`);
console.log(`  approximate        ${counts.approximate}  <- not usable for distance`);
console.log(`  failed             ${failures.length}`);
console.log(`\n${usable} rows usable for comp distance matching.`);

if (approximates.length) {
  console.log(`\nAddresses that only resolved to a centroid (worth correcting):`);
  approximates.slice(0, 20).forEach((a) => console.log(`  ${a}`));
  if (approximates.length > 20) console.log(`  ...and ${approximates.length - 20} more`);
}
if (failures.length) {
  console.log(`\nNo result at all:`);
  failures.slice(0, 20).forEach((f) => console.log(`  ${f}`));
  if (failures.length > 20) console.log(`  ...and ${failures.length - 20} more`);
}
