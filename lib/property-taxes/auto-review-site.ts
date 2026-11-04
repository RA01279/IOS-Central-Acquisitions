// lib/property-taxes/auto-review-site.ts
//
// Runs Hopper's automatic tax review with the outlined site (same-owner touching
// county parcels and their recorded acreage) for the subject's pin. A failed
// parcel lookup only means fewer automatic approvals; it never fails a save.

import type { TaxState } from "./types";
import { autoReview, type SiteFootprint } from "./auto-review";
import { parcelFootprint } from "@/lib/ic-deck/site-geo";

export async function siteFootprint(subject: { latitude?: unknown; longitude?: unknown; lot_sf?: unknown }): Promise<SiteFootprint | null> {
  const lat = Number(subject.latitude), lng = Number(subject.longitude);
  if (subject.latitude == null || subject.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const acres = subject.lot_sf != null && Number(subject.lot_sf) > 0 ? Number(subject.lot_sf) / 43560 : null;
  const fp = await Promise.race([parcelFootprint(lat, lng, acres), new Promise<null>((r) => setTimeout(() => r(null), 20000))]).catch(() => null);
  return fp ? { accountIds: fp.accountIds, matchesDeal: fp.matchesDeal } : null;
}

/** autoReview with a precomputed footprint (pass the same one for a subject and all its deals). */
export function reviewed(state: TaxState, site: SiteFootprint | null): TaxState {
  try { return autoReview(state, site).state; } catch { return state; }
}
