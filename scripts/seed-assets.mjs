// scripts/seed-assets.mjs
//
// Seeds the owned-asset portfolio from dalfen.com/ios.
//
//   node scripts/seed-assets.mjs            # report only, writes nothing
//   node scripts/seed-assets.mjs --apply
//
// Transcribed by hand from pages 1-3 of that listing (page 4 is the end of the
// pagination) rather than scraped at runtime, deliberately:
//
//   - It's a marketing page. Its markup will change without notice, and a
//     scraper wired into the app would break silently and take the portfolio
//     map with it.
//   - It publishes address, city, state and occupancy, and no acreage or
//     building size. So a scrape wouldn't save anyone the data entry that
//     actually matters -- those get typed in, once, and kept.
//   - 40 rows is not a volume problem.
//
// Idempotent: keyed on lower(address), so re-running updates in place. It will
// NOT overwrite site_acres, building_sf, market, submarket or a hand-dropped
// pin -- those are things a person adds afterwards, and a re-seed shouldn't
// undo them.
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const APPLY = process.argv.includes("--apply");
const SOURCE = "https://www.dalfen.com/ios/";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""), l.slice(l.indexOf("=") + 1).trim()])
);
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

const ts = (await import("typescript")).default;
const src = fileURLToPath(new URL("../lib/geocode.ts", import.meta.url));
const tmp = new URL("../lib/.geocode.seed.mjs", import.meta.url);
writeFileSync(fileURLToPath(tmp), ts.transpileModule(readFileSync(src, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText);
const { geocodeAddress } = await import(tmp.href);

// address, city, state, occupancy. "Sold" becomes status rather than occupancy.
const ASSETS = [
  // -- page 1 --
  ["6818 FM 2855 Rd", "Katy", "TX", "occupied"],
  ["16310 Aldine Westfield Rd", "Houston", "TX", "occupied"],
  ["2901 W Airport Blvd", "Sanford", "FL", "occupied"],
  ["19101 Oil Center Dr", "Houston", "TX", "occupied"],
  ["1901 Terminal Rd", "Fort Worth", "TX", "available"],
  ["1207-1209 Round Table Dr", "Dallas", "TX", "occupied"],
  ["95 & 135 Hermit Smith Rd", "Apopka", "FL", "available"],
  ["2833 Westside Dr", "Pasadena", "TX", "occupied"],
  ["110 Jim Benton Ct", "Savannah", "GA", "occupied"],
  ["10701 Todd St", "Houston", "TX", "available"],
  ["1901 Jasmine Dr", "Pasadena", "TX", "occupied"],
  ["2720 Industrial Ln", "Garland", "TX", "occupied"],
  ["7061 Rt 35", "South Amboy", "NJ", "available"],
  ["2916 Apopka Blvd", "Apopka", "FL", "occupied"],
  ["8188 N Orange Blossom Trl", "Apopka", "FL", "occupied"],
  ["332 Martin St", "Houston", "TX", "available"],
  // -- page 2 --
  ["3833 Jodeco Rd", "McDonough", "GA", "occupied"],
  ["9773 Harry Hines Blvd", "Dallas", "TX", "occupied"],
  ["2959 Irving Blvd", "Dallas", "TX", "occupied"],
  ["3802 Washington Rd", "Atlanta", "GA", "occupied"],
  ["9090 Forney Rd", "Dallas", "TX", "occupied"],
  ["10111 Harmon Rd", "Fort Worth", "TX", "occupied"],
  ["6000 Split Trail Rd", "Plano", "TX", "available"],
  ["23422 Clawiter Rd", "Hayward", "CA", "available"],
  ["847-877 Industrial Pkwy", "Hayward", "CA", "occupied"],
  ["10203 East St #1", "Oakland", "CA", "occupied"],
  ["10203 East St #2", "Oakland", "CA", "available"],
  ["2610-2620 Durahart St", "Riverside", "CA", "occupied"],
  ["12731 Los Nietos Rd", "Santa Fe Springs", "CA", "occupied"],
  ["7563 Dahlia St", "Commerce City", "CO", "available"],
  ["1911 NW 15th St", "Pompano Beach", "FL", "available"],
  ["375 NW 9th Ave & 1011 Old Griffin Rd", "Dania Beach", "FL", "available"],
  // -- page 3 --
  ["6111 Sheriff Rd", "Landover", "MD", "available"],
  ["9595 Lynn Buff Ct", "Laurel", "MD", "sold"],
  ["83 Gross Ave", "Edison", "NJ", "available"],
  ["369-399 Old Water Works Rd", "Old Bridge", "NJ", "occupied"],
  ["2 Gowin St", "Sayreville", "NJ", "occupied"],
  ["501 & 529 S 16th St", "La Porte", "TX", "occupied"],
  ["214 21st St", "Auburn", "WA", "occupied"],
  ["8328 Tacoma Way", "Lakewood", "WA", "occupied"],
];

// The metro each city belongs to, so the portfolio slices the same way comps
// do. Only cities that are actually in the list.
const MARKET = {
  Katy: "Houston", Houston: "Houston", Pasadena: "Houston", "La Porte": "Houston",
  Dallas: "Dallas", Garland: "Dallas", Plano: "Dallas",
  "Fort Worth": "Fort Worth",
  Savannah: "Savannah",
  Sanford: "Orlando", Apopka: "Orlando",
  "Pompano Beach": "South Florida", "Dania Beach": "South Florida",
  McDonough: "Atlanta", Atlanta: "Atlanta",
  Hayward: "East Bay", Oakland: "East Bay",
  Riverside: "Inland Empire", "Santa Fe Springs": "Los Angeles",
  "Commerce City": "Denver",
  "South Amboy": "New Jersey", Edison: "New Jersey", "Old Bridge": "New Jersey",
  Sayreville: "New Jersey",
  Landover: "Baltimore/Washington", Laurel: "Baltimore/Washington",
  Auburn: "Seattle", Lakewood: "Seattle",
};

const REST = `${env.SUPABASE_URL}/rest/v1`;
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

const existing = await (await fetch(`${REST}/assets?select=*`, { headers })).json();
if (!Array.isArray(existing)) {
  console.error("Could not read assets:", existing);
  process.exit(1);
}
const byAddress = new Map(existing.map((a) => [a.address.toLowerCase(), a]));
console.log(
  `${ASSETS.length} assets on the site, ${existing.length} already in the table` +
    `${APPLY ? "" : "   (dry run — nothing will be written)"}\n`
);

let inserted = 0, updated = 0, skipped = 0, ungeocoded = 0;
for (const [address, city, state, occ] of ASSETS) {
  const prior = byAddress.get(address.toLowerCase());
  const sold = occ === "sold";

  // Geocode only when we don't already have a usable point. A hand-dropped pin
  // is never overwritten by a re-seed.
  let geo = null;
  const keepPin =
    prior && prior.latitude != null &&
    ["rooftop", "range_interpolated", "geometric_center", "supplied", "manual"].includes(
      prior.geocode_precision
    );
  if (!keepPin) {
    geo = await geocodeAddress([address, city], { state });
    if (!geo) ungeocoded++;
  }

  const row = {
    address,
    city,
    state,
    market: prior?.market ?? MARKET[city] ?? null,
    asset_class: "ios",
    status: sold ? "sold" : (prior?.status === "under_contract" ? "under_contract" : "owned"),
    occupancy: sold ? null : occ,
    source_url: SOURCE,
    ...(geo
      ? {
          latitude: geo.lat,
          longitude: geo.lng,
          geocode_precision: geo.precision,
          geocoded_at: new Date().toISOString(),
        }
      : {}),
  };

  const label = `${address}, ${city} ${state}`;
  if (!prior) {
    console.log(`  + ${label}  ${geo ? `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)} (${geo.precision})` : "NOT GEOCODED"}`);
    inserted++;
    if (APPLY) {
      const res = await fetch(`${REST}/assets`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      if (!res.ok) console.log(`      ! ${res.status} ${await res.text()}`);
    }
    continue;
  }

  // Only report a change where something actually differs.
  const differs =
    prior.city !== city || prior.state !== state ||
    prior.status !== row.status || prior.occupancy !== row.occupancy ||
    (geo && prior.latitude == null);
  if (!differs) { skipped++; continue; }
  console.log(
    `  ~ ${label}  ${prior.occupancy ?? prior.status} -> ${row.occupancy ?? row.status}` +
      `${geo ? `   placed at ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}` : ""}`
  );
  updated++;
  if (APPLY) {
    const res = await fetch(`${REST}/assets?id=eq.${prior.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString(), updated_by: "seed-assets" }),
    });
    if (!res.ok) console.log(`      ! ${res.status} ${await res.text()}`);
  }
}

console.log(
  `\n${inserted} to insert, ${updated} to update, ${skipped} unchanged, ${ungeocoded} without coordinates.`
);
if (ungeocoded) {
  console.log(`Those can be placed by hand on the asset's page, the same way a comp is.`);
}
if (!APPLY && (inserted || updated)) console.log(`Re-run with --apply to write.`);
unlinkSync(fileURLToPath(tmp));
