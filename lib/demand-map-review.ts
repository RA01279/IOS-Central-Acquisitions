import { validAnalysis } from "./analysis-validation";
import { haversineMiles } from "./ic-deck/geo";
import type { DemandMapResponse } from "./ic-deck/iosDemandMap";
import type { DemandSnapshot } from "./site-score";

export const BUSINESS_MAP_TITLE = "Demand Map";
export const BUSINESS_MAP_LIMITATION = "Selected business locations only; inclusion does not establish an active leasing requirement or site suitability. Up to 8 businesses per category; not a market inventory.";
export interface DemandMapPayload { data: DemandMapResponse; excluded: string[] }
export interface DemandMapReview { version: number; created_at: string; created_by: string; payload: DemandMapPayload }

/** One reviewed selection for every map, count and presentation. Never fall back to old scored searches. */
export function reviewedMap(payload: unknown): DemandMapResponse | null {
  if (!validAnalysis("demand", payload)) return null;
  const p = payload as DemandMapPayload;
  const excluded = new Set(p.excluded);
  return { ...p.data, tenants: p.data.tenants.filter(t => !excluded.has(t.placeId)).map(t => ({
    ...t, distanceMi: haversineMiles(p.data.center.lat, p.data.center.lng, t.lat, t.lng),
  })).filter(t => t.distanceMi <= p.data.radiusMiles) };
}
export function snapshotFromReview(review: DemandMapReview | null): DemandSnapshot | null {
  const map = review ? reviewedMap(review.payload) : null;
  return map ? { center: map.center, radiusMiles: map.radiusMiles, fetchedAt: map.fetchedAt ?? "", tenants: map.tenants } : null;
}
export function observationLabel(data: DemandMapResponse): string {
  return data.fetchedAt && Number.isFinite(Date.parse(data.fetchedAt))
    ? new Date(data.fetchedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")
    : "Unavailable (legacy review)";
}
export function reviewMatchesPin(review: DemandMapReview, lat: number | null, lng: number | null): boolean {
  const map = reviewedMap(review.payload);
  return !!map && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    && haversineMiles(map.center.lat, map.center.lng, lat, lng) <= 0.02;
}
