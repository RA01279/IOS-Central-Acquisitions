// scripts/regeocode-comps.mjs
//
// Re-resolve comps whose coordinates are wrong or missing.
//
// Written for the fallout of a real bug: the geocoder appended ", TX" to every
// address and restricted the lookup with administrative_area:TX. That is a hard
// filter -- Google cannot return anything outside it, and hands back the state
// centroid rather than admitting it found nothing. Nine suites at 2025
// Louisville Road, Savannah, GEORGIA landed in Savannah, Texas and at the
// geographic centre of Texas, about 800 miles out.
//
//   node scripts/regeocode-comps.mjs            # report only, writes nothing
//   node scripts/regeocode-comps.mjs --apply    # write the corrections
//
// Only touches rows whose new coordinates differ materially, and prints the
// distance moved for every one so a bad correction is visible before --apply.
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const APPLY = process.argv.includes("--apply");
const FILTER = process.argv.find((a) => a.startsWith("--where="))?.slice(8) ?? null;

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""), l.slice(l.indexOf("=") + 1).trim()])
);
for (const [k, val] of Object.entries(env)) if (!process.env[k]) process.env[k] = val;

const ts = (await import("typescript")).default;
const src = fileURLToPath(new URL("../lib/geocode.ts", import.meta.url));
const tmp = new URL("../lib/.geocode.run.mjs", import.meta.url);
writeFileSync(fileURLToPath(tmp), ts.transpileModule(readFileSync(src, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText);
const { geocodeAddress, isUsableForDistance } = await import(tmp.href);

const REST = `${env.SUPABASE_URL}/rest/v1`;
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

const miles = (a, b, c, d) => {
  const R = 3958.7613, r = (x) => (x * Math.PI) / 180;
  const dLat = r(c - a), dLng = r(d - b);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
};

const query = FILTER
  ? `${REST}/comps?select=*&${FILTER}`
  // Default target: rows a state-locked lookup would have got wrong -- anything
  // that only ever resolved to a centroid, plus anything with no coordinates.
  : `${REST}/comps?select=*&or=(geocode_precision.eq.approximate,latitude.is.null)`;

const rows = await (await fetch(query, { headers })).json();
if (!Array.isArray(rows)) {
  console.error("Could not read comps:", rows);
  process.exit(1);
}
console.log(`${rows.length} comp(s) to re-check${APPLY ? "" : "  (dry run — nothing will be written)"}\n`);

let moved = 0, improved = 0, unchanged = 0, failed = 0;
for (const c of rows) {
  const g = await geocodeAddress([c.address, c.city, c.market], { state: c.state });
  if (!g) {
    failed++;
    console.log(`  ✗ ${c.address}${c.suite ? ` ${c.suite}` : ""} — no result`);
    continue;
  }
  const had = c.latitude != null && c.longitude != null;
  const dist = had ? miles(Number(c.latitude), Number(c.longitude), g.lat, g.lng) : null;
  const betterPrecision = !isUsableForDistance(c.geocode_precision) && isUsableForDistance(g.precision);
  const materially = !had || dist > 0.25 || betterPrecision;

  if (!materially) { unchanged++; continue; }
  moved++;
  if (betterPrecision) improved++;
  console.log(
    `  ${c.address}${c.suite ? ` ${c.suite}` : ""}  [${c.state ?? "state?"}]\n` +
    `      ${had ? `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)} (${c.geocode_precision})` : "no coordinates"}` +
    `  ->  ${g.lat.toFixed(4)}, ${g.lng.toFixed(4)} (${g.precision})` +
    `${dist !== null ? `   moved ${dist.toFixed(1)} mi` : ""}\n` +
    `      ${g.formatted}`
  );

  if (APPLY) {
    const res = await fetch(`${REST}/comps?id=eq.${c.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        latitude: g.lat, longitude: g.lng,
        geocode_precision: g.precision,
        geocoded_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) console.log(`      ! write failed: ${res.status} ${await res.text()}`);
  }
}

console.log(
  `\n${moved} would move (${improved} to a usable precision), ${unchanged} already right, ${failed} unresolvable.`
);
if (!APPLY && moved) console.log(`Re-run with --apply to write these.`);
unlinkSync(fileURLToPath(tmp));
