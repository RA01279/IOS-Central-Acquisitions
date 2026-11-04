// lib/ic-deck/site-geo.ts
//
// Two exhibits the exec summary used to leave to the analyst:
//
//  - parcelFootprint: the site's parcel boundary from the same public parcel
//    layers Hopper uses for owners (TxGIO statewide in Texas, county assessor
//    layers in Georgia). A site is often several parcels, so touching parcels
//    with the same owner of record are added, and the total is checked against
//    the deal's acreage. A mismatch is reported, never hidden.
//
//  - highwayAccess: the nearest limited-access highway (Census TIGERweb) with two measures, because analysts quote both: drive to the
//    closest point of the highway, and drive to the nearest on-ramp. Drive
//    distance and time come from Google's Routes API (traffic-unaware).
//
// Every lookup is best effort with timeouts: a failure leaves the slide's
// analyst prompt in place and never fails the deck.

import { COUNTY_SOURCES } from "../sourcing/parcels";

type LL = [number, number]; // [lat, lng]

export interface ParcelFootprint {
  rings: LL[][];
  acres: number;
  owner: string | null;
  parcelCount: number;
  dealAcres: number | null;
  /** Within 5% of the deal's acreage (null when the deal has none). */
  matchesDeal: boolean | null;
  source: string;
  /** Appraisal account IDs of the parcels (Texas only; empty where the layer has none). */
  accountIds: string[];
}

export interface HighwayAccess {
  highway: string;
  toHighway: { miles: number; minutes: number; point: LL; polyline: string | null };
  toRamp: { miles: number; minutes: number; point: LL; polyline: string | null; exit: string | null } | null;
}

const TX_LAYER = "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer";
const SQM_PER_ACRE = 4046.8564224;
const inBox = (lat: number, lng: number, [s, n, w, e]: number[]) => lat >= s && lat <= n && lng >= w && lng <= e;
const inTexas = (lat: number, lng: number) => inBox(lat, lng, [25.8, 36.6, -106.7, -93.5]);
const ownerKey = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(LLC|INC|LP|LTD|CO|CORP)$/, "");

async function getJson(url: URL | string, init: RequestInit = {}, ms = 10000): Promise<any> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---------- geometry ---------------------------------------------------------

const mercToLL = ([x, y]: number[]): LL => [(2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI, (x / 6378137) * 180 / Math.PI];
/** Local planar metres around lat0 -- accurate to well under 1% at site scale. */
const toXY = ([lat, lng]: LL, lat0: number) => [lng * 111320 * Math.cos(lat0 * Math.PI / 180), lat * 110540];

export function ringAcres(ring: LL[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][0];
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = toXY(ring[i], lat0), [x2, y2] = toXY(ring[(i + 1) % ring.length], lat0);
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2) / SQM_PER_ACRE;
}

function segDist(p: number[], a: number[], b: number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx, y = a[1] + t * dy;
  return { d: Math.hypot(p[0] - x, p[1] - y), x, y };
}
/** Parcels "touch" when any vertex of one lies within 3 m of the other's edge. */
function touches(a: LL[][], b: LL[][], lat0: number) {
  const edges = (rings: LL[][]) => rings.flatMap(r => r.map((p, i) => [toXY(p, lat0), toXY(r[(i + 1) % r.length], lat0)]));
  const ea = edges(a), eb = edges(b);
  const near = (pts: LL[][], es: number[][][]) => pts.flat().some(p => { const q = toXY(p, lat0); return es.some(([s, e]) => segDist(q, s, e).d < 3); });
  return near(a, eb) || near(b, ea);
}

const miles = (m: number) => m / 1609.344;
const haversine = ([a, b]: LL, [c, d]: LL) => {
  const t = Math.PI / 180, x = Math.sin((c - a) * t / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(x));
};

// ---------- parcels ----------------------------------------------------------

/** legalAcres: the assessor's recorded area -- what deals are underwritten on. */
type Found = { owner: string | null; rings: LL[][]; legalAcres: number | null; accountId?: string | null };
const positive = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

async function texasParcels(lat: number, lng: number, d: number, point: boolean): Promise<Found[]> {
  const url = new URL(`${TX_LAYER}/identify`);
  url.search = new URLSearchParams({
    geometry: point ? `${lng},${lat}` : JSON.stringify({ xmin: lng - d, ymin: lat - d, xmax: lng + d, ymax: lat + d, spatialReference: { wkid: 4326 } }),
    geometryType: point ? "esriGeometryPoint" : "esriGeometryEnvelope", sr: "4326", layers: "all:0", tolerance: "0",
    mapExtent: [lng - d, lat - d, lng + d, lat + d].join(","), imageDisplay: "400,400,96", returnGeometry: "true", f: "json",
  }).toString();
  const j = await getJson(url);
  return (j.results ?? []).map((r: any) => {
    const wkid = r.geometry?.spatialReference?.latestWkid ?? r.geometry?.spatialReference?.wkid;
    const conv = (p: number[]): LL => (wkid === 4326 ? [p[1], p[0]] : mercToLL(p));
    // LEGAL_AREA is acres unless the district marks it as square feet.
    const legal = positive(r.attributes?.LEGAL_AREA), sqft = /SF|SQ/i.test(String(r.attributes?.LGL_AREA_UNIT ?? ""));
    const attr = Object.fromEntries(Object.entries(r.attributes ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { owner: r.attributes?.OWNER_NAME ?? null, accountId: attr.prop_id == null || attr.prop_id === "" || attr.prop_id === "Null" ? null : String(attr.prop_id).trim(), legalAcres: legal == null ? null : sqft ? legal / 43560 : legal, rings: (r.geometry?.rings ?? []).map((ring: number[][]) => ring.map(conv)) };
  }).filter((f: Found) => f.rings.length);
}

async function countyParcels(lat: number, lng: number, d: number, point: boolean): Promise<{ found: Found[]; source: string } | null> {
  const src = COUNTY_SOURCES.find(s => inBox(lat, lng, s.bounds));
  if (!src) return null;
  const url = new URL(`${src.layer}/query`);
  url.search = new URLSearchParams({
    geometry: point ? `${lng},${lat}` : `${lng - d},${lat - d},${lng + d},${lat + d}`,
    geometryType: point ? "esriGeometryPoint" : "esriGeometryEnvelope", inSR: "4326", outSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: [src.owner, src.acres, src.areaSqft].filter(Boolean).join(","), returnGeometry: "true", f: "json",
  }).toString();
  const j = await getJson(url);
  return { source: src.name, found: (j.features ?? []).map((f: any) => ({
    owner: f.attributes?.[src.owner] ?? null,
    legalAcres: src.acres ? positive(f.attributes?.[src.acres]) : src.areaSqft && positive(f.attributes?.[src.areaSqft]) ? positive(f.attributes[src.areaSqft])! / 43560 : null,
    rings: (f.geometry?.rings ?? []).map((r: number[][]) => r.map(p => [p[1], p[0]] as LL)),
  })).filter((f: Found) => f.rings.length) };
}

export async function parcelFootprint(lat: number, lng: number, dealAcres: number | null): Promise<ParcelFootprint | null> {
  try {
    const d = 0.004; // ~400 m: room for a large multi-parcel yard
    let main: Found | undefined, nearby: Found[] = [], source: string;
    if (inTexas(lat, lng)) {
      source = "TxGIO StratMap Land Parcels (county appraisal district)";
      [main] = await texasParcels(lat, lng, 0.001, true);
      if (main) nearby = await texasParcels(lat, lng, d, false);
    } else {
      const at = await countyParcels(lat, lng, d, true);
      if (!at) return null;
      source = at.source; main = at.found[0];
      if (main) nearby = (await countyParcels(lat, lng, d, false))?.found ?? [];
    }
    if (!main) return null;
    const key = ownerKey(main.owner);
    const cluster: Found[] = [main];
    // Grow the site through touching parcels of the same owner of record.
    const pool = key ? nearby.filter(f => ownerKey(f.owner) === key && ringAcres(f.rings[0]) > 0) : [];
    const sameShape = (a: Found, b: Found) => Math.abs(ringAcres(a.rings[0]) - ringAcres(b.rings[0])) < 1e-6 && haversine(a.rings[0][0], b.rings[0][0]) < 1;
    let grew = true;
    while (grew && cluster.length < 12) {
      grew = false;
      for (const f of pool) {
        if (cluster.some(c => sameShape(c, f))) continue;
        if (cluster.some(c => touches(c.rings, f.rings, lat))) { cluster.push(f); grew = true; }
      }
    }
    const rings = cluster.flatMap(c => c.rings);
    const drawn = (c: Found) => c.rings.reduce((t, r, i) => t + (i === 0 ? ringAcres(r) : -ringAcres(r)), 0);
    // Recorded legal acreage when every parcel has it; otherwise the drawn area.
    const legal = cluster.every(c => c.legalAcres != null);
    const acres = Math.round(cluster.reduce((s, c) => s + (legal ? c.legalAcres! : drawn(c)), 0) * 100) / 100;
    return {
      rings, acres, owner: main.owner, parcelCount: cluster.length, dealAcres,
      matchesDeal: dealAcres ? Math.abs(acres / dealAcres - 1) <= 0.05 : null,
      accountIds: cluster.every(c => c.accountId) ? [...new Set(cluster.map(c => c.accountId!))] : [],
      source: `${source}; acreage ${legal ? "as recorded by the assessor" : "measured from the drawn boundary"}`,
    };
  } catch { return null; }
}

// ---------- highway access ---------------------------------------------------

// Highways and ramps from the Census Bureau's TIGERweb (nationwide, keyless,
// ~1 s). Primary roads (MTFCC S1100) are the limited-access main lanes;
// ramps are MTFCC S1630 in the local roads layer.
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer";

async function tiger(layer: number, lat: number, lng: number, radiusM: number, where = "1=1"): Promise<Array<{ name: string; paths: LL[][] }>> {
  const dLat = radiusM / 110540, dLng = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  const url = new URL(`${TIGER}/${layer}/query`);
  url.search = new URLSearchParams({
    geometry: [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326",
    spatialRel: "esriSpatialRelIntersects", where, outFields: "NAME,MTFCC", returnGeometry: "true", f: "json",
  }).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await getJson(url, {}, 15000);
      if (j.error) throw new Error(j.error.message);
      return (j.features ?? []).map((f: any) => ({ name: String(f.attributes?.NAME ?? ""), paths: (f.geometry?.paths ?? []).map((p: number[][]) => p.map(([x, y]) => [y, x] as LL)) }));
    } catch { /* retry once */ }
  }
  return [];
}

async function drive(from: LL, to: LL): Promise<{ miles: number; minutes: number; polyline: string | null } | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  try {
    const j = await getJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from[0], longitude: from[1] } } },
        destination: { location: { latLng: { latitude: to[0], longitude: to[1] } } },
        travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE",
      }),
    }, 10000);
    const r = j.routes?.[0];
    if (!r?.distanceMeters) return null;
    return { miles: miles(r.distanceMeters), minutes: Math.max(1, Math.round(parseInt(String(r.duration), 10) / 60)), polyline: r.polyline?.encodedPolyline ?? null };
  } catch { return null; }
}

/** TIGER names -> how highways are written in a deck: "State Hwy 249" -> "SH 249", "I- 45" -> "I-45". */
export function highwayName(raw: string, statePrefix = "SH"): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(?:I|Ih|Interstate)[- ]*(\d+[A-Z]?)\b/i))) return `I-${m[1]}`;
  if ((m = s.match(/^US (?:Hwy|Highway) (\d+[A-Z]?)\b/i))) return `US ${m[1]}`;
  if ((m = s.match(/^State (?:Hwy|Highway|Rte|Route) (\d+[A-Z]?)\b/i))) return `${statePrefix} ${m[1]}`;
  if ((m = s.match(/^State (Loop|Spur) (\d+)\b/i))) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
  if (/^(Beltway \d+|.*Tollway|.*Toll Rd)$/i.test(s)) return s;
  return null;
}

function closestOn(paths: LL[][], site: LL, lat0: number) {
  const o = toXY(site, lat0);
  let best = { d: Infinity, point: site as LL };
  for (const p of paths) for (let i = 0; i < p.length - 1; i++) {
    const s = segDist(o, toXY(p[i], lat0), toXY(p[i + 1], lat0));
    if (s.d < best.d) best = { d: s.d, point: [s.y / 110540, s.x / (111320 * Math.cos(lat0 * Math.PI / 180))] };
  }
  return best;
}

export async function highwayAccess(lat: number, lng: number): Promise<HighwayAccess | null> {
  const site: LL = [lat, lng];
  // Freeway main lanes (S1100) and other numbered state/US highways (S1200):
  // a highway is often at-grade near a site and limited-access further on,
  // so "closest point of the highway" uses both, and ramps only the former.
  const [mains, secondary, ramps] = await Promise.all([
    tiger(2, lat, lng, 12000), tiger(6, lat, lng, 12000, "MTFCC='S1200'"), tiger(8, lat, lng, 12000, "MTFCC='S1630'"),
  ]);
  // Texas writes state highways "SH 249"; most states, Georgia included, "SR 92".
  const prefix = inTexas(lat, lng) ? "SH" : "SR";
  const name = (raw: string) => highwayName(raw, prefix);
  const numbered = [...mains, ...secondary].map(r => ({ ...r, ref: name(r.name) })).filter(r => r.ref);
  if (!numbered.length) return null;
  const scored = numbered.map(r => ({ ...r, ...closestOn(r.paths, site, lat) })).sort((a, b) => a.d - b.d);
  const nearest = scored[0];
  const highway = nearest.ref!;
  // This highway's freeway lanes, including segments TIGER names locally
  // ("Tomball Pkwy" runs on top of "State Hwy 249").
  const named = mains.filter(r => name(r.name) === highway);
  const mainPaths = [...named, ...mains.filter(r => !name(r.name) && named.some(n => {
    const mid = r.paths[0]?.[Math.floor(r.paths[0].length / 2)];
    return mid && closestOn(n.paths, mid, lat).d < 40;
  }))].flatMap(r => r.paths);
  // On-ramp: the far end of a ramp that meets this highway (within 40 m of its main lanes).
  const access = ramps.flatMap(r => r.paths.map(p => {
    const [a, b] = [p[0], p[p.length - 1]];
    const da = closestOn(mainPaths, a, lat).d, db = closestOn(mainPaths, b, lat).d;
    return Math.min(da, db) < 40 && Math.max(da, db) > 60 ? (da < db ? b : a) : null;
  })).filter((p): p is LL => !!p)
    .map(point => ({ point, d: haversine(site, point) })).sort((a, b) => a.d - b.d).slice(0, 3);
  const [toHighway, ...rampDrives] = await Promise.all([drive(site, nearest.point), ...access.map(r => drive(site, r.point))]);
  if (!toHighway) return null;
  const ramp = access.map((r, i) => ({ ...r, drive: rampDrives[i] })).filter(r => r.drive)
    .sort((a, b) => a.drive!.minutes - b.drive!.minutes || a.drive!.miles - b.drive!.miles)[0];
  return {
    highway,
    toHighway: { miles: toHighway.miles, minutes: toHighway.minutes, point: nearest.point, polyline: toHighway.polyline },
    toRamp: ramp ? { miles: ramp.drive!.miles, minutes: ramp.drive!.minutes, point: ramp.point, polyline: ramp.drive!.polyline, exit: null } : null,
  };
}

export function highwayCaption(h: HighwayAccess): string {
  const one = (m: number) => m.toFixed(1);
  const min = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;
  return `${h.highway}: ${one(h.toHighway.miles)} miles | ${min(h.toHighway.minutes)} to the highway` +
    (h.toRamp ? `; ${one(h.toRamp.miles)} miles | ${min(h.toRamp.minutes)} to the nearest ${h.highway} on-ramp${h.toRamp.exit ? ` (${h.toRamp.exit})` : ""}` : "");
}

// ---------- Static Maps helpers ---------------------------------------------

/** Google encoded polyline, so parcel outlines fit in a Static Maps URL. */
export function encodePolyline(points: LL[]): string {
  let out = "", pLat = 0, pLng = 0;
  const enc = (v: number) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, ln] of points) { const a = Math.round(la * 1e5), b = Math.round(ln * 1e5); out += enc(a - pLat) + enc(b - pLng); pLat = a; pLng = b; }
  return out;
}

export function parcelPaths(p: ParcelFootprint): string[] {
  return p.rings.map(r => `color:0xffd400ff|weight:4|fillcolor:0xffd40030|enc:${encodePolyline(r)}`);
}
