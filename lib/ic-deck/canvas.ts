// lib/ic-deck/canvas.ts
//
// IOS market canvas for slides 12-15, from the acquisitions team's ArcGIS
// inventory layers: every inventoried IOS property within a radius of the
// site, summarized by tenant use and owner type (count, gross acres, share,
// occupied acres, acreage vacancy, mean / standard deviation of site size),
// plus the points for the occupancy, tenancy and ownership maps.
//
// Credentials: ARCGIS_API_KEY, or ARCGIS_USERNAME + ARCGIS_PASSWORD (a
// view-only account is enough). Nothing here is ever shown in the deck except
// the inventory name and its last-updated date.

import { encodePolyline } from "@/lib/ic-deck/site-geo";

export const CANVAS_RADIUS_MILES = 5;
const MIN_PROPERTIES = 10;
const PORTAL = (process.env.ARCGIS_PORTAL || "https://dalfen.maps.arcgis.com").replace(/\/+$/, "");
// Tokens are bound to a referer; any fixed value works as long as every request sends it.
const REFERER = "https://ios-central-acquisitions.vercel.app";

/** Regional inventories, newest first. The first with enough properties near the site wins. */
export const CANVAS_SOURCES: Array<{ itemId: string; name: string }> = [
  { itemId: "9442cc94e9744ff68016b038294ad723", name: "South Central IOS (Houston)" },
  { itemId: "a01820691c994c3c96f88ae4a592befe", name: "Central Region IOS Inventory" },
  { itemId: "6ef077a164374c1ab4970b790a497783", name: "Southeast Region IOS Inventory" },
  { itemId: "ed194dcdcd1e4bd1bb494db880eb6c99", name: "West Region IOS Inventory" },
  { itemId: "32777186f1c24c8589a7d70fc3a30cf2", name: "Northeast Region IOS Inventory" },
];

export interface CanvasRow { label: string; count: number; acres: number; share: number; occupiedAcres: number | null; vacancy: number | null; mean: number; stdev: number | null }
export interface CanvasPoint { lat: number; lng: number; occupancy: string; tenantUse: string; owner: string }
export interface MarketCanvas {
  source: { name: string; title: string; updated: string };
  radiusMiles: number;
  /** Most common Dalfen submarket among the properties. */
  submarket: string | null;
  total: CanvasRow;
  tenantUse: CanvasRow[];
  ownerType: CanvasRow[];
  points: CanvasPoint[];
}

// Map colors (hex, no #), close to the ArcGIS map's own symbology.
export const OCCUPANCY_COLORS: Record<string, string> = { Leased: "F07470", Vacant: "6FA8DC", "Partially Leased": "9BD35A", Other: "A0A0A0" };
export const OWNER_COLORS: Record<string, string> = { User: "F07470", "Institutional Owner": "6FA8DC", Other: "A0A0A0" };
const TENANT_PALETTE = ["E8746A", "6E9FD0", "9ACD5B", "A66BBE", "F0A04B", "5FC3B5", "B7A6D6", "F2B8C6", "E9D65A", "7F8C99", "C9E3A6", "D98880"];
export function tenantColors(labels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  labels.forEach((l, i) => { out[l] = l === "Other" ? "A0A0A0" : TENANT_PALETTE[i % TENANT_PALETTE.length]; });
  return out;
}

// ---- ArcGIS access ----------------------------------------------------------
let cached: { token: string; until: number } | null = null;
async function token(): Promise<string | null> {
  if (process.env.ARCGIS_API_KEY) return process.env.ARCGIS_API_KEY;
  const username = process.env.ARCGIS_USERNAME, password = process.env.ARCGIS_PASSWORD;
  if (!username || !password) return null;
  if (cached && cached.until > Date.now()) return cached.token;
  const r = await fetch(`${PORTAL}/sharing/rest/generateToken`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ username, password, referer: REFERER, expiration: "120", f: "json" }),
  });
  const j: any = await r.json().catch(() => null);
  if (!j?.token) return null;
  cached = { token: j.token, until: Date.now() + 100 * 60000 };
  return j.token;
}

async function get(url: string, params: Record<string, string>, tok: string): Promise<any> {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: REFERER }, signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ ...params, f: "json", token: tok }),
  });
  const j: any = await r.json();
  if (j?.error) throw new Error(`ArcGIS: ${j.error.message ?? "request failed"}`);
  return j;
}

const layerCache = new Map<string, { url: string; title: string; updated: string }>();
async function layerOf(itemId: string, tok: string) {
  const hit = layerCache.get(itemId);
  if (hit) return hit;
  const item = await get(`${PORTAL}/sharing/rest/content/items/${itemId}`, {}, tok);
  if (!item?.url) throw new Error("ArcGIS item has no service");
  const v = { url: `${item.url}/0`, title: String(item.title ?? itemId), updated: new Date(item.modified).toISOString().slice(0, 10) };
  layerCache.set(itemId, v);
  return v;
}

const near = (lat: number, lng: number, radiusMiles: number) => ({
  geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326",
  spatialRel: "esriSpatialRelIntersects", distance: String(radiusMiles), units: "esriSRUnit_StatuteMile", where: "1=1",
});

// ---- summary math (exported for tests) -----------------------------------------
export interface CanvasRecord { acres: number | null; occupiedAcres: number | null; occupancy: string | null; tenantUse: string | null; owner: string | null }

export function summarize(label: string, list: CanvasRecord[], totalAcres: number): CanvasRow {
  const acresOf = (r: CanvasRecord) => (r.acres != null && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : 0);
  const acres = list.reduce((a, r) => a + acresOf(r), 0);
  // Vacancy is by acreage, over the properties whose occupied acreage is known.
  const known = list.filter((r) => r.occupiedAcres != null && Number.isFinite(r.occupiedAcres));
  const knownAcres = known.reduce((a, r) => a + acresOf(r), 0);
  const occupiedAcres = known.length ? known.reduce((a, r) => a + Math.min(Math.max(r.occupiedAcres!, 0), acresOf(r)), 0) : null;
  const mean = list.length ? acres / list.length : 0;
  const stdev = list.length > 1 ? Math.sqrt(list.reduce((a, r) => a + (acresOf(r) - mean) ** 2, 0) / (list.length - 1)) : null;
  return {
    label, count: list.length, acres, share: totalAcres > 0 ? acres / totalAcres : 0,
    occupiedAcres, vacancy: occupiedAcres != null && knownAcres > 0 ? 1 - occupiedAcres / knownAcres : null, mean, stdev,
  };
}

/** Rows by category, largest first by count, "Other" last. Blank categories are "Other". */
export function breakdown(records: CanvasRecord[], key: "tenantUse" | "owner", totalAcres: number): CanvasRow[] {
  const groups = new Map<string, CanvasRecord[]>();
  for (const r of records) { const k = (r[key] ?? "").trim() || "Other"; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return [...groups.entries()].map(([k, list]) => summarize(k, list, totalAcres))
    .sort((a, b) => (a.label === "Other" ? 1 : 0) - (b.label === "Other" ? 1 : 0) || b.count - a.count || a.label.localeCompare(b.label));
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// ---- submarket of a single pin -------------------------------------------------
/** How far around a pin to look for inventoried properties, and how many of the nearest decide. */
export const SUBMARKET_RADIUS_MILES = 3;
const SUBMARKET_NEAREST = 5;

/**
 * The Dalfen submarket for a pin, from the labelled inventory points around
 * it: the most common label among the nearest few, ties going to the nearest.
 * Pure, for tests.
 */
export function submarketFromPoints(lat: number, lng: number, points: Array<{ lat: number | null; lng: number | null; submarket: string | null }>): string | null {
  const labelled = points
    .filter((p) => p.lat != null && p.lng != null && (p.submarket ?? "").trim())
    .map((p) => ({ label: p.submarket!.trim(), d: (p.lat! - lat) ** 2 + ((p.lng! - lng) * Math.cos((lat * Math.PI) / 180)) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, SUBMARKET_NEAREST);
  if (!labelled.length) return null;
  const votes = new Map<string, { n: number; first: number }>();
  labelled.forEach((p, i) => { const v = votes.get(p.label); votes.set(p.label, v ? { n: v.n + 1, first: v.first } : { n: 1, first: i }); });
  return [...votes.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)[0][0];
}

const submarketCache = new Map<string, string | null>();

/**
 * The Dalfen submarket a pin sits in, read from the acquisitions team's
 * ArcGIS inventory (the same layers as the market canvas). Null when ArcGIS
 * isn't configured or no inventoried property is within a few miles. Never
 * throws: a missing submarket must not stop a comp from saving.
 */
export async function submarketAt(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (submarketCache.has(key)) return submarketCache.get(key)!;
  let tok: string | null = null;
  try { tok = await token(); } catch { return null; }
  if (!tok) return null;
  let found: string | null = null;
  let failed = false;
  for (const s of CANVAS_SOURCES) {
    try {
      const layer = await layerOf(s.itemId, tok);
      const page = await get(`${layer.url}/query`, {
        ...near(lat, lng, SUBMARKET_RADIUS_MILES), where: "Dalfen_Submarkets IS NOT NULL",
        outFields: "Dalfen_Submarkets", returnGeometry: "true", outSR: "4326", resultRecordCount: "500",
      }, tok);
      found = submarketFromPoints(lat, lng, (page.features ?? []).map((f: any) => ({ lat: num(f.geometry?.y), lng: num(f.geometry?.x), submarket: f.attributes?.Dalfen_Submarkets ?? null })));
      if (found) break;
    } catch { failed = true; /* next inventory */ }
  }
  // A miss caused by an ArcGIS error isn't remembered, so the next save retries.
  if (found || !failed) submarketCache.set(key, found);
  return found;
}

/** The market canvas around a site, or null when no inventory covers it (or ArcGIS isn't configured). */
export async function marketCanvas(lat: number, lng: number, radiusMiles = CANVAS_RADIUS_MILES): Promise<MarketCanvas | null> {
  const tok = await token();
  if (!tok) return null;
  const counts = await Promise.all(CANVAS_SOURCES.map(async (s) => {
    try {
      const layer = await layerOf(s.itemId, tok);
      const c = await get(`${layer.url}/query`, { ...near(lat, lng, radiusMiles), returnCountOnly: "true" }, tok);
      return { s, layer, count: Number(c.count) || 0 };
    } catch { return null; }
  }));
  const pick = counts.find((c) => c && c.count >= MIN_PROPERTIES);
  if (!pick) return null;

  const fields = "Land_Area__AC_,Occupied_Acreage,Occupancy__Verified_,Tenant_Use,Owner_Type,Dalfen_Submarkets";
  const features: any[] = [];
  for (let offset = 0; offset < 5000; ) {
    const page = await get(`${pick.layer.url}/query`, { ...near(lat, lng, radiusMiles), outFields: fields, returnGeometry: "true", outSR: "4326", resultOffset: String(offset), resultRecordCount: "1000" }, tok);
    features.push(...(page.features ?? []));
    if (!page.exceededTransferLimit || !(page.features ?? []).length) break;
    offset += page.features.length;
  }
  const records = features.map((f) => {
    const a = f.attributes ?? {};
    return {
      acres: num(a.Land_Area__AC_), occupiedAcres: num(a.Occupied_Acreage),
      occupancy: a.Occupancy__Verified_ ?? null, tenantUse: a.Tenant_Use ?? null, owner: a.Owner_Type ?? null,
      submarket: a.Dalfen_Submarkets ?? null, lat: num(f.geometry?.y), lng: num(f.geometry?.x),
    };
  });
  if (records.length < MIN_PROPERTIES) return null;
  const total = summarize("Total", records, 0);
  total.share = 1;
  const subs = new Map<string, number>();
  for (const r of records) if (r.submarket) subs.set(r.submarket, (subs.get(r.submarket) ?? 0) + 1);
  return {
    source: { name: pick.s.name, title: pick.layer.title, updated: pick.layer.updated },
    radiusMiles,
    submarket: [...subs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    total,
    tenantUse: breakdown(records, "tenantUse", total.acres),
    ownerType: breakdown(records, "owner", total.acres),
    points: records
      // Points with swapped/positive longitudes etc. are dropped rather than plotted far away.
      .filter((r) => r.lat != null && r.lng != null && Math.abs(r.lat - lat) < 1 && Math.abs(r.lng - lng) < 1)
      .map((r) => ({ lat: r.lat!, lng: r.lng!, occupancy: (r.occupancy ?? "").trim() || "Other", tenantUse: (r.tenantUse ?? "").trim() || "Other", owner: (r.owner ?? "").trim() || "Other" })),
  };
}

// ---- static map parameters ---------------------------------------------------------
/** A closed ring approximating the search radius, for drawing on the map. */
export function radiusRing(lat: number, lng: number, miles: number, n = 48): Array<[number, number]> {
  const dLat = miles / 69.0, dLng = miles / (69.0 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: n + 1 }, (_, i) => { const t = (2 * Math.PI * i) / n; return [lat + dLat * Math.sin(t), lng + dLng * Math.cos(t)] as [number, number]; });
}

/**
 * A fixed Web Mercator view of the site for the canvas maps: centered on the
 * pin, zoomed so the radius ring fills the height (it may run slightly past the
 * edges). The deck draws the property dots itself over this image, so the
 * view must be explicit (center + zoom), never auto-fitted by Google.
 */
export interface MapView { lat: number; lng: number; zoom: number; width: number; height: number }
export function canvasMapView(site: { lat: number; lng: number }, radiusMiles: number, width: number, height: number): MapView {
  const metersPerPx = (radiusMiles * 2 * 1609.344) / (height * 1.1);
  const zoom = Math.max(8, Math.min(16, Math.floor(Math.log2((156543.03392 * Math.cos((site.lat * Math.PI) / 180)) / metersPerPx))));
  return { lat: site.lat, lng: site.lng, zoom, width, height };
}
export function ringPath(site: { lat: number; lng: number }, radiusMiles: number) {
  return `color:0xffffffcc|weight:2|enc:${encodePolyline(radiusRing(site.lat, site.lng, radiusMiles))}`;
}
/** Position of a point within the view, as fractions of width/height (0-1 = inside). */
export function projectToView(v: MapView, lat: number, lng: number): [number, number] {
  const world = (la: number, ln: number) => {
    const s = Math.sin((Math.max(-85, Math.min(85, la)) * Math.PI) / 180), scale = 256 * 2 ** v.zoom;
    return [((ln + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
  };
  const [cx, cy] = world(v.lat, v.lng), [px, py] = world(lat, lng);
  return [(px - cx) / v.width + 0.5, (py - cy) / v.height + 0.5];
}
