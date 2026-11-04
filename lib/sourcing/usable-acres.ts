// lib/sourcing/usable-acres.ts
//
// Net usable acres for a parcel, measured from its outline: the parcel less
// building footprints, then the FEMA 100-year floodplain, then mapped
// wetlands, then ground over a 5% grade, then strips under ~60 ft wide, each
// counted once where they overlap. Every deduction is kept so
// "10.4 gross -> 6.2 net" can be explained line by line.
//
// Sources (all free, no key), probed on Houston and Atlanta parcels:
//  - USA Structures (FEMA / ORNL): building footprints nationwide.
//  - FEMA NFHL flood hazard zones: SFHA_TF = "T" is the 1%-annual-chance
//    floodplain, including the floodway.
//  - USFWS National Wetlands Inventory.
//  - USGS 3DEP bare-earth elevation (steep ground; see site-raster.ts).
// Not measured here: easements, setbacks and paved vs raw ground. They are
// listed as not checked rather than assumed clear.

import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from "polygon-clipping";
import type { UsableAcres } from "./usable-summary";
import { frameAt, rasterize, sampleTerrain, steepCells, wideEnough, count, MIN_WIDTH_M, STEEP_GRADE } from "./site-raster";
export { usableSummary, type UsableAcres } from "./usable-summary";

/** Esri polygon rings, [lng, lat] in WGS84. */
export type Rings = number[][][];


export const STRUCTURES = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0";
export const NFHL_ZONES = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";
export const NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0";
export const NOT_CHECKED = ["easements", "setbacks", "paved vs raw ground"];
const SQM_PER_ACRE = 4046.8564224;
const SQFT_PER_SQM = 10.7639104;
const R = 6378137;

// Parcels are small enough that a flat projection about the parcel's own
// centre is accurate to well under 0.1%.
function areaSqm(geom: MultiPolygon, lat0: number): number {
  const kx = (R * Math.PI / 180) * Math.cos(lat0 * Math.PI / 180), ky = R * Math.PI / 180;
  const ring = (r: Ring) => {
    let s = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * kx) * (r[i][1] * ky) - (r[i][0] * kx) * (r[j][1] * ky);
    return Math.abs(s) / 2;
  };
  return geom.reduce((sum, poly) => sum + ring(poly[0]) - poly.slice(1).reduce((h, r) => h + ring(r), 0), 0);
}

const unionAll = (geoms: Array<Polygon | MultiPolygon>): MultiPolygon => (geoms.length ? polygonClipping.union(geoms[0], ...geoms.slice(1)) : []);
const signedArea = (r: number[][]) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return s; };

/**
 * Esri rings to a polygon-clipping multipolygon. Esri outer rings run
 * clockwise and holes counter-clockwise; a layer that ignores the rule (all
 * rings one way) is read as outers only.
 */
export function ringsToGeom(rings: Rings): MultiPolygon {
  const valid = rings.filter((r) => r.length >= 4).map((r) => r.map(([x, y]) => [x, y] as [number, number]));
  if (!valid.length) return [];
  // Negative under this sum is clockwise (an outer ring); positive is a hole.
  const outers = valid.filter((r) => signedArea(r) < 0), holes = valid.filter((r) => signedArea(r) > 0);
  if (!outers.length || !holes.length) return unionAll(valid.map((r) => [r] as Polygon));
  const solid = unionAll(outers.map((r) => [r] as Polygon));
  return polygonClipping.difference(solid, ...holes.map((r) => [r] as Polygon));
}

type Feature = { attributes: Record<string, any>; geometry?: { rings?: Rings } };

async function query(layer: string, parcel: Rings, fetcher: typeof fetch, outFields: string): Promise<Feature[]> {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ rings: parcel, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPolygon",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields, returnGeometry: "true",
    // ~1 m generalisation: flood and wetland polygons can carry thousands of vertices.
    maxAllowableOffset: "0.00001", geometryPrecision: "7", f: "json",
  });
  // FEMA's server drops connections intermittently under parallel load; the
  // same request succeeds moments later. Three tries before calling it unread.
  let last: unknown;
  for (const wait of [0, 800, 2000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetcher(`${layer}/query`, { method: "POST", body, signal: AbortSignal.timeout(15000) } as RequestInit);
      if (!r.ok) throw new Error(`${layer} ${r.status}`);
      const j = await r.json();
      if (j?.error || !Array.isArray(j?.features)) throw new Error(`${layer} ${j?.error?.message ?? "returned no features"}`);
      return j.features;
    } catch (e) { last = e; }
  }
  throw last;
}

const geomOf = (fs: Feature[]): MultiPolygon => {
  const parts = fs.flatMap((f) => (f.geometry?.rings?.length ? ringsToGeom(f.geometry.rings) : []));
  try { return unionAll(parts.map((p) => [p] as MultiPolygon)); } catch { return unionAll(parts.map((p) => snap([p]))); }
};
// polygon-clipping occasionally fails on nearly coincident edges ("Unable to
// find segment ... in SweepLine tree"). Retry with coordinates snapped to
// ~10 cm, which resolves it; a second failure is reported by the caller.
const snap = (g: MultiPolygon): MultiPolygon => g.map((p) => p.map((r) => r.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6] as [number, number])));
function robust(op: (a: MultiPolygon, b: MultiPolygon) => MultiPolygon, a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  try { return op(a, b); } catch { return op(snap(a), snap(b)); }
}
const clip = (a: MultiPolygon, b: MultiPolygon) => (a.length && b.length ? robust((x, y) => polygonClipping.intersection(x, y), a, b) : []);
const minus = (a: MultiPolygon, b: MultiPolygon) => (a.length && b.length ? robust((x, y) => polygonClipping.difference(x, y), a, b) : a);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Measure net usable acres for a parcel outline. Null when the outline has no area. */
export async function measureUsableAcres(outline: Rings, fetcher: typeof fetch = fetch, opts: { terrain?: boolean } = {}): Promise<UsableAcres | null> {
  const parcel = ringsToGeom(outline);
  const lat0 = outline[0]?.reduce((s, p) => s + p[1], 0) / (outline[0]?.length || 1);
  const lng0 = outline[0]?.reduce((s, p) => s + p[0], 0) / (outline[0]?.length || 1);
  const gross = areaSqm(parcel, lat0);
  if (!(gross > 0)) return null;
  const frame = frameAt(lat0, lng0);
  // Elevation is sampled over the whole parcel while the map layers load.
  const terrainP = opts.terrain === false ? Promise.resolve(undefined) : sampleTerrain(rasterize(parcel, frame, 20000), frame, fetcher).catch(() => null);

  const [b, f, w] = await Promise.allSettled([
    query(STRUCTURES, outline, fetcher, "BUILD_ID"),
    query(NFHL_ZONES, outline, fetcher, "FLD_ZONE,ZONE_SUBTY,SFHA_TF"),
    query(NWI, outline, fetcher, "*"),
  ]);
  const failed: UsableAcres["failed"] = [];
  const ok = (r: PromiseSettledResult<Feature[]>, name: UsableAcres["failed"][number]) => (r.status === "fulfilled" ? r.value : (failed.push(name), []));
  const buildings = ok(b, "buildings");
  const flood = ok(f, "flood").filter((x) => x.attributes?.SFHA_TF === "T");
  const wetlands = ok(w, "wetlands");

  // Deduct in order so an overlap counts once: buildings, then floodplain
  // outside them, then wetlands outside both.
  // A layer whose geometry cannot be clipped even after snapping is reported
  // as not read, like a layer the service failed to return.
  const layer = (rest: MultiPolygon, fs: Feature[], name: UsableAcres["failed"][number]): MultiPolygon => {
    try { return clip(rest, geomOf(fs)); } catch { if (!failed.includes(name)) failed.push(name); return []; }
  };
  const onBuildings = layer(parcel, buildings, "buildings");
  const rest1 = minus(parcel, onBuildings);
  const inFlood = layer(rest1, flood, "flood");
  const rest2 = minus(rest1, inFlood);
  const inWetland = layer(rest2, wetlands, "wetlands");
  const afterMaps = minus(rest2, inWetland);

  // Steep ground, then strips too narrow to use, on a grid over what is left.
  // Grid areas are scaled to the polygon area so rounding at the cell edges
  // never shifts the total.
  const terrain = await terrainP;
  if (terrain === null) failed.push("slope");
  const grid = rasterize(afterMaps, frame);
  const cells = count(grid.on);
  const perCell = cells ? areaSqm(afterMaps, lat0) / cells : 0;
  const steep = terrain ? steepCells(grid, terrain) : new Uint8Array(grid.on.length);
  const flat = new Uint8Array(grid.on.length);
  for (let i = 0; i < flat.length; i++) flat[i] = grid.on[i] && !steep[i] ? 1 : 0;
  const usable = wideEnough(flat, grid);
  const steepSqm = count(steep) * perCell, narrowSqm = (count(flat) - count(usable)) * perCell;

  const acres = (g: MultiPolygon) => round(areaSqm(g, lat0) / SQM_PER_ACRE);
  const footprintSqm = areaSqm(onBuildings, lat0);
  const zoneLabel = (a: Record<string, any>) => [a.FLD_ZONE, a.ZONE_SUBTY && /floodway/i.test(a.ZONE_SUBTY) ? "floodway" : null].filter(Boolean).join(" ");
  const wetlandType = (a: Record<string, any>) => a.WETLAND_TYPE ?? a.Wetlands_Type ?? a.ATTRIBUTE ?? null;
  return {
    grossAcres: round(gross / SQM_PER_ACRE),
    netAcres: round(Math.max(0, areaSqm(afterMaps, lat0) - steepSqm - narrowSqm) / SQM_PER_ACRE),
    buildingsAcres: acres(onBuildings),
    floodAcres: acres(inFlood),
    wetlandsAcres: acres(inWetland),
    steepAcres: round(steepSqm / SQM_PER_ACRE),
    narrowAcres: round(narrowSqm / SQM_PER_ACRE),
    // Footprints that only touch the boundary from next door are not on this parcel.
    buildingCount: buildings.filter((x) => { try { return areaSqm(clip(parcel, geomOf([x])), lat0) > 5; } catch { return false; } }).length,
    coveragePct: round((footprintSqm / gross) * 100, 1),
    buildingFootprintSf: Math.round(footprintSqm * SQFT_PER_SQM),
    floodZones: [...new Set(flood.map((x) => zoneLabel(x.attributes)).filter(Boolean))],
    wetlandTypes: [...new Set(wetlands.map((x) => wetlandType(x.attributes)).filter(Boolean))] as string[],
    failed,
    notChecked: terrain === undefined ? [...NOT_CHECKED, "slope"] : NOT_CHECKED,
    thresholds: { steepGrade: STEEP_GRADE, minWidthFt: Math.round(MIN_WIDTH_M * 3.28084) },
    measuredAt: new Date().toISOString(),
  };
}

/** Measure many outlines with bounded concurrency and an overall deadline. */
export async function measureMany(outlines: Array<Rings | null | undefined>, limit = 6, budgetMs = 45000, fetcher: typeof fetch = fetch): Promise<Array<UsableAcres | null>> {
  const out: Array<UsableAcres | null> = new Array(outlines.length).fill(null);
  const deadline = Date.now() + budgetMs;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, outlines.length) }, async () => {
    while (next < outlines.length) {
      const i = next++, o = outlines[i];
      if (!o?.length || Date.now() >= deadline) continue;
      try { out[i] = await measureUsableAcres(o, fetcher); } catch { out[i] = null; }
    }
  }));
  return out;
}
