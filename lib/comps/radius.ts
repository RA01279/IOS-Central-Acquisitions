// lib/comps/radius.ts
//
// Comps within N miles of a point, nearest first -- the engine behind the
// Comps page's "Comps near an address" export (app/api/comps/radius-export).
// Pure, so the test can feed it rows.
//
// Only comps whose pin is good enough to measure from count (the same rule
// distance matching uses: rooftop, interpolated, centre-of-parcel, supplied
// or hand-placed). Portfolio aggregate rows are left out -- they have no one
// location -- but a portfolio's individual sites are kept and flagged, since
// their prices are allocations rather than stand-alone trades.

import { haversineMiles } from "./match";
import { isUsableForDistance } from "../geocode";

export type RadiusType = "lease" | "sale" | "both";
export type RadiusClass = "all" | "ios" | "industrial";

export type RadiusComp = {
  id: string;
  comp_type: string;
  status: string;
  latitude: number | string | null;
  longitude: number | string | null;
  geocode_precision: string | null;
  asset_class: string | null;
  is_portfolio?: boolean | null;
  portfolio_transaction_id?: string | null;
  [key: string]: unknown;
};

export const RADIUS_CHOICES = [1, 3, 5, 10, 15, 25, 50] as const;
export const MAX_RADIUS_MILES = 100;

/** Google Maps opened on the satellite view, centred on the comp. */
export function aerialUrl(lat: number, lng: number, zoom = 19): string {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat.toFixed(6)},${lng.toFixed(6)}&zoom=${zoom}&basemap=satellite`;
}

/** Confirmed comps of the asked-for type and class within `miles`, nearest first, each with its distance. */
export function compsWithin<T extends RadiusComp>(
  comps: T[],
  center: { lat: number; lng: number },
  miles: number,
  type: RadiusType,
  assetClass: RadiusClass = "all"
): (T & { distanceMiles: number; lat: number; lng: number })[] {
  // A degree of latitude is ~69 miles; a cheap box first, exact distance after.
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)));
  const out: (T & { distanceMiles: number; lat: number; lng: number })[] = [];
  for (const c of comps) {
    if (c.status !== "confirmed" || c.is_portfolio) continue;
    if (type !== "both" && c.comp_type !== type) continue;
    if (type === "both" && c.comp_type !== "lease" && c.comp_type !== "sale") continue;
    if (assetClass !== "all" && c.asset_class !== assetClass) continue;
    if (!isUsableForDistance(c.geocode_precision)) continue;
    const lat = Number(c.latitude), lng = Number(c.longitude);
    if (c.latitude == null || c.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat - center.lat) > dLat || Math.abs(lng - center.lng) > dLng) continue;
    const d = haversineMiles(center.lat, center.lng, lat, lng);
    if (d <= miles) out.push({ ...c, distanceMiles: d, lat, lng });
  }
  return out.sort((a, b) => a.distanceMiles - b.distanceMiles);
}

/** Request values -> a valid search, or the reason it isn't one. */
export function parseRadiusQuery(q: { address?: string | null; miles?: string | null; type?: string | null; class?: string | null }):
  | { ok: true; address: string; miles: number; type: RadiusType; assetClass: RadiusClass }
  | { ok: false; error: string } {
  const address = (q.address ?? "").trim();
  if (!address || address.length > 300) return { ok: false, error: "Enter a street address, city and state." };
  const miles = Number(q.miles);
  if (!Number.isFinite(miles) || miles <= 0 || miles > MAX_RADIUS_MILES) return { ok: false, error: `Pick a radius between 0 and ${MAX_RADIUS_MILES} miles.` };
  const type: RadiusType = q.type === "lease" || q.type === "sale" ? q.type : "both";
  const assetClass: RadiusClass = q.class === "ios" || q.class === "industrial" ? q.class : "all";
  return { ok: true, address, miles, type, assetClass };
}
