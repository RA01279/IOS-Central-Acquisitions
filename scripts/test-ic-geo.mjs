// scripts/test-ic-geo.mjs
//
// Tests lib/ic-deck/geo.ts -- the Web Mercator arithmetic that places pins on
// an exported slide.
//
// This is worth testing precisely because a mistake here is invisible: every
// pin lands slightly off, consistently, and the map looks deliberate. An
// earlier version of the demand map placed pins with a hardcoded
// inches-per-mile and was wrong at every latitude except the one it was tuned
// at. The assertions below check the projection against distances computed
// independently by haversine.
//   node scripts/test-ic-geo.mjs
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const ts = (await import("typescript")).default;
const src = fileURLToPath(new URL("../lib/ic-deck/geo.ts", import.meta.url));
const tmp = new URL("../lib/ic-deck/.geo.test.mjs", import.meta.url);
writeFileSync(
  fileURLToPath(tmp),
  ts.transpileModule(readFileSync(src, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
);
const {
  haversineMiles, milesPerLogicalPixel, zoomForRadiusMiles, mapGeometryFor, latLngToWorldPixel,
} = await import(tmp.href);

let pass = 0, fail = 0;
function near(label, actual, expected, tol) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (ok) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ${expected} ±${tol}, got ${actual}`); }
}
function eq(label, actual, expected) {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log("== haversine against known distances ==");
// Dallas (Harry Hines) to Houston (Oil Center): ~225 mi great-circle.
near("Dallas to Houston", haversineMiles(32.8535, -96.8789, 29.9838, -95.3372), 225, 8);
// The Oakbrook rent roll to a Savannah GA reference: same city, a few miles.
near("within one city", haversineMiles(32.0817, -81.1256, 32.0809, -81.0912), 2.0, 0.4);
eq("zero distance to itself", Number(haversineMiles(30, -95, 30, -95).toFixed(9)), 0);

console.log("\n== zoom fits the radius, never crops it ==");
for (const [radius, lat] of [[5, 30], [25, 30], [25, 47.3], [100, 30], [1, 32]]) {
  const z = zoomForRadiusMiles(radius, lat, 640);
  const half = (640 / 2) * milesPerLogicalPixel(lat, z);
  // The chosen zoom must COVER the radius...
  if (half >= radius) pass++;
  else { fail++; console.log(`  FAIL zoom ${z} at lat ${lat} covers only ${half.toFixed(1)} of ${radius} mi`); }
  // ...and one zoom deeper must NOT, or it zoomed out further than needed.
  const halfDeeper = (640 / 2) * milesPerLogicalPixel(lat, z + 1);
  if (halfDeeper < radius) pass++;
  else { fail++; console.log(`  FAIL zoom ${z} at lat ${lat} is too far out; ${z + 1} would still fit`); }
}
// Latitude matters: the same radius needs a different zoom in Seattle than in
// Houston, because a pixel covers less ground further from the equator.
const zHouston = zoomForRadiusMiles(25, 29.76, 640);
const zSeattle = zoomForRadiusMiles(25, 47.61, 640);
eq("higher latitude needs a wider zoom for the same radius", zSeattle <= zHouston, true);

console.log("\n== pin placement matches real distance ==");
// A point due north of centre must land straight up, at the right scale.
const CENTER = { lat: 29.7604, lng: -95.3698 }; // Houston
const zoom = zoomForRadiusMiles(25, CENTER.lat, 640);
const MAP_SIDE = 5.9;
const geo = mapGeometryFor(CENTER.lat, CENTER.lng, zoom, 640, MAP_SIDE);

const north = { lat: CENTER.lat + 10 / 69, lng: CENTER.lng }; // ~10 mi north
const offN = geo.offsetInches(north.lat, north.lng);
near("due north has no sideways offset", offN.dx, 0, 0.001);
near("due north is UP the slide (negative dy)", Math.sign(offN.dy), -1, 0);
near(
  "10 miles north measures 10 miles on the slide",
  Math.abs(offN.dy) / geo.inchesPerMile,
  haversineMiles(CENTER.lat, CENTER.lng, north.lat, north.lng),
  0.15
);

const east = { lat: CENTER.lat, lng: CENTER.lng + 10 / (69 * Math.cos((CENTER.lat * Math.PI) / 180)) };
const offE = geo.offsetInches(east.lat, east.lng);
near("due east has no vertical offset", offE.dy, 0, 0.001);
near("due east is RIGHT (positive dx)", Math.sign(offE.dx), 1, 0);
near(
  "10 miles east measures 10 miles on the slide",
  Math.abs(offE.dx) / geo.inchesPerMile,
  haversineMiles(CENTER.lat, CENTER.lng, east.lat, east.lng),
  0.15
);

near("the centre is at the centre", offN.dx + geo.offsetInches(CENTER.lat, CENTER.lng).dx, 0, 0.001);
eq("centre dy is zero", Number(geo.offsetInches(CENTER.lat, CENTER.lng).dy.toFixed(9)), 0);

// The map's half-extent must equal half the drawn side in miles -- that's what
// makes a distance ring at the radius touch the edge rather than overflow it.
near(
  "half extent lines up with the drawn size",
  geo.halfExtentMi * geo.inchesPerMile,
  MAP_SIDE / 2,
  0.001
);
// And the radius the zoom was chosen for must actually fit inside the image.
if (geo.halfExtentMi >= 25) pass++;
else { fail++; console.log(`  FAIL 25 mi radius doesn't fit: half extent ${geo.halfExtentMi.toFixed(1)} mi`); }

console.log("\n== projection sanity ==");
// Web Mercator: x grows with longitude, y grows SOUTHWARD.
const a = latLngToWorldPixel(30, -95, 12);
const b = latLngToWorldPixel(30, -94, 12);
eq("east is a larger x", b.x > a.x, true);
const c = latLngToWorldPixel(29, -95, 12);
eq("south is a larger y", c.y > a.y, true);
// Doubling the zoom doubles the pixel scale.
const z10 = latLngToWorldPixel(30, -95, 10);
const z11 = latLngToWorldPixel(30, -95, 11);
near("one zoom level doubles the scale", z11.x / z10.x, 2, 1e-9);

unlinkSync(fileURLToPath(tmp));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
