// lib/sourcing/sweep.ts
//
// Off-market sweep: find businesses operating from outdoor yards around a
// point, group the ones sharing a site, and mark the sites Hopper already
// knows about (any deal including archived targets, an owned asset, a comp).
// The operators are the signal -- a trucking company or equipment renter is
// sitting on an IOS property whether or not anyone has listed it.

import { haversineMiles } from "@/lib/comps/match";
import { DEFAULT_CATEGORIES, normalizeName, rejectReason } from "./yard-users";
import { likelyOwnerUser, type Parcel } from "./parcels";

export interface Operator { placeId: string; name: string; category: string }
export interface Known { kind: "deal" | "asset" | "comp"; id: string; label: string; href: string; distanceMi: number }
export interface Site {
  ref: string;
  lat: number;
  lng: number;
  address: string;
  distanceMi: number;
  operators: Operator[];
  categories: string[];
  known: Known | null;
  /** Owner of record from the appraisal roll, when the pin falls on a parcel. */
  parcel: Parcel | null;
  /** Owner of record looks like one of the operators: a sale-leaseback lead. */
  ownerUser: boolean;
}
export interface KnownPoint { kind: Known["kind"]; id: string; label: string; href: string; lat: number; lng: number }

/** Businesses this close together are treated as one yard (shared parcel or campus). */
const SAME_SITE_MI = 0.075;
/** A Hopper record this close to a site is the same property. */
const KNOWN_MI = 0.12;

type Place = { place_id: string; name: string; vicinity?: string; geometry: { location: { lat: number; lng: number } }; business_status?: string; types?: string[] };

export async function searchYardUsers(center: { lat: number; lng: number }, radiusMiles: number, key: string, fetcher: typeof fetch = fetch) {
  const radius = String(Math.round(radiusMiles * 1609.34));
  let screened = 0;
  const found = new Map<string, Place & { category: string }>();
  const jobs = DEFAULT_CATEGORIES.flatMap((cat) => cat.keywords.map((keyword) => ({ cat, keyword })));
  const results = await Promise.all(jobs.map(async ({ cat, keyword }) => {
    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.search = new URLSearchParams({ location: `${center.lat},${center.lng}`, radius, keyword, key }).toString();
    try {
      const r = await fetcher(url, { signal: AbortSignal.timeout(10000) } as RequestInit);
      const data = await r.json();
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return { cat, places: [] as Place[], failed: true };
      return { cat, places: (data.results ?? []) as Place[], failed: false };
    } catch {
      return { cat, places: [] as Place[], failed: true };
    }
  }));
  const failed = results.filter((r) => r.failed).length;
  for (const { cat, places } of results) {
    for (const p of places) {
      if (rejectReason(p, cat.label)) { screened++; continue; }
      if (!found.has(p.place_id)) found.set(p.place_id, { ...p, category: cat.label });
    }
  }
  return { places: [...found.values()], screened, failedSearches: failed, totalSearches: jobs.length };
}

/** "1720 N Sam Houston Pkwy E Ste 4, Houston" -> "1720 n sam houston pkwy e": same street address, any suite. */
function streetKey(address: string | undefined): string | null {
  const first = (address ?? "").split(",")[0].toLowerCase().replace(/\s*(#|\bste\b|\bsuite\b|\bunit\b|\bbldg\b).*$/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return /^\d+ \S/.test(first) ? first : null;
}

/**
 * Attach parcels, then fold together sites whose pins fall on the same parcel:
 * one parcel is one acquisition, however many businesses Google lists on it.
 */
export function attachParcels(sites: Site[], parcels: Array<Parcel | null>): Site[] {
  const byParcel = new Map<string, Site>();
  const out: Site[] = [];
  sites.forEach((s, i) => {
    const parcel = parcels[i] ?? null;
    const key = parcel?.propId && parcel.county ? `${parcel.county}:${parcel.propId}` : null;
    const first = key ? byParcel.get(key) : undefined;
    if (first) {
      for (const op of s.operators) if (!first.operators.some((o) => o.placeId === op.placeId)) first.operators.push(op);
      for (const c of s.categories) if (!first.categories.includes(c)) first.categories.push(c);
      first.known ??= s.known;
      return;
    }
    const merged = { ...s, parcel };
    if (key) byParcel.set(key, merged);
    out.push(merged);
  });
  return out.map((s, i) => ({ ...s, ref: `S${i + 1}`, ownerUser: likelyOwnerUser(s.parcel?.owner ?? null, s.operators.map((o) => o.name)) }));
}

export function buildSites(center: { lat: number; lng: number }, radiusMiles: number, places: Array<Place & { category: string }>, known: KnownPoint[]): Site[] {
  const seenNames = new Set<string>();
  const inRange = places
    .map((p) => ({ p, d: haversineMiles(center.lat, center.lng, p.geometry.location.lat, p.geometry.location.lng) }))
    .filter(({ d }) => d <= radiusMiles)
    .sort((a, b) => a.d - b.d)
    // Chains and duplicate listings: one pin per operator name.
    .filter(({ p }) => { const k = normalizeName(p.name); if (seenNames.has(k)) return false; seenNames.add(k); return true; });

  const sites: Site[] = [];
  for (const { p, d } of inRange) {
    const { lat, lng } = p.geometry.location;
    const op = { placeId: p.place_id, name: p.name, category: p.category };
    const street = streetKey(p.vicinity);
    const near = sites.find((s) => haversineMiles(s.lat, s.lng, lat, lng) <= SAME_SITE_MI || (street !== null && streetKey(s.address) === street));
    if (near) {
      near.operators.push(op);
      if (!near.categories.includes(p.category)) near.categories.push(p.category);
      continue;
    }
    sites.push({ ref: `S${sites.length + 1}`, lat, lng, address: p.vicinity ?? "", distanceMi: d, operators: [op], categories: [p.category], known: null, parcel: null, ownerUser: false });
  }
  for (const s of sites) {
    let best: Known | null = null;
    for (const k of known) {
      const dist = haversineMiles(s.lat, s.lng, k.lat, k.lng);
      if (dist <= KNOWN_MI && (!best || dist < best.distanceMi)) best = { kind: k.kind, id: k.id, label: k.label, href: k.href, distanceMi: dist };
    }
    s.known = best;
  }
  return sites;
}
