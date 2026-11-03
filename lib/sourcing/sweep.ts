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
import { discoverYardUsers, type DiscoveryOptions } from "./discovery";
import { addressKey, parcelKey, addressConflict } from "./identity";
import type { UsableAcres } from "./usable-summary";

export interface Operator { placeId: string; name: string; category: string; sourcePlaceIds?: string[]; profileIds?: string[]; categories?: string[]; phone?: string | null; website?: string | null; googleUrl?: string | null }
export interface Known { kind: "deal" | "asset" | "comp"; id: string; label: string; href: string; distanceMi: number; stage?: string; match?: "same_property" | "nearby"; relation?: "active-deal" | "archived-deal" | "owned-asset" | "asset" | "comp"; evidence?: "parcel" | "address" | "distance" }
export interface Site {
  ref: string;
  lat: number;
  lng: number;
  address: string;
  distanceMi: number;
  operators: Operator[];
  categories: string[];
  profileIds?: string[];
  known: Known | null;
  /** Owner of record from the appraisal roll, when the pin falls on a parcel. */
  parcel: Parcel | null;
  /** Owner of record looks like one of the operators: a sale-leaseback lead. */
  ownerUser: boolean;
  nearby?: Known[];
  /** Net usable acres measured from the parcel outline; null when not measured. */
  usable?: UsableAcres | null;
  identityStatus?: "parcel-matched" | "address-conflict" | "unverified";
}
export interface KnownPoint { kind: Known["kind"]; id: string; label: string; href: string; lat: number; lng: number; address?: string; stage?: string; status?: string; parcel?: Parcel | null }

/** Nearby records provide context, without establishing property identity. */
const KNOWN_MI = 0.12;

type Place = { place_id: string; name: string; vicinity?: string; geometry: { location: { lat: number; lng: number } }; business_status?: string; types?: string[]; categories?: string[]; profileIds?: string[] };

export async function searchYardUsers(center: { lat: number; lng: number }, radiusMiles: number, key: string, fetcher: typeof fetch = fetch, profiles: { id?: string; label: string; keywords: string[] }[] = DEFAULT_CATEGORIES, options?: DiscoveryOptions) {
  return discoverYardUsers(center, radiusMiles, key, fetcher, profiles, options);
}

function mergeOperator(operators: Operator[], op: Operator) {
  const prior = operators.find((o) => o.placeId === op.placeId || normalizeName(o.name) === normalizeName(op.name));
  if (!prior) { operators.push({ ...op }); return; }
  prior.profileIds = [...new Set([...(prior.profileIds ?? []), ...(op.profileIds ?? [])])];
  prior.sourcePlaceIds = [...new Set([...(prior.sourcePlaceIds ?? [prior.placeId]), ...(op.sourcePlaceIds ?? [op.placeId])])];
  prior.categories = [...new Set([...(prior.categories ?? [prior.category]), ...(op.categories ?? [op.category])])];
  prior.phone ??= op.phone; prior.website ??= op.website; prior.googleUrl ??= op.googleUrl;
}

/** Business contacts from Google, never represented as verified owner contacts. */
export async function enrichBusinessContacts(sites: Site[], key: string, fetcher: typeof fetch = fetch) {
  const operators = sites.flatMap((s) => s.operators);
  const deadline = Date.now() + 18000;
  for (const op of operators) op.googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(op.name)}&query_place_id=${encodeURIComponent(op.placeId)}`;
  let next = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(12, operators.length) }, async () => {
    while (next < operators.length) {
      const op = operators[next++];
      if (Date.now() >= deadline) { failed++; continue; }
      try {
        const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
        url.search = new URLSearchParams({ place_id: op.placeId, fields: "formatted_phone_number,website,url", key }).toString();
        const data = await (await fetcher(url, { signal: AbortSignal.timeout(6000) })).json();
        if (data.status !== "OK") { failed++; continue; }
        op.phone = typeof data.result?.formatted_phone_number === "string" ? data.result.formatted_phone_number : null;
        op.website = safeWebUrl(data.result?.website);
        op.googleUrl = safeWebUrl(data.result?.url) ?? op.googleUrl;
      } catch { failed++; }
    }
  }));
  return { requested: operators.length, failed };
}

function safeWebUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) ? u.href : null; } catch { return null; }
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
      for (const op of s.operators) mergeOperator(first.operators, op);
      for (const c of s.categories) if (!first.categories.includes(c)) first.categories.push(c);
      first.profileIds = [...new Set([...(first.profileIds ?? []), ...(s.profileIds ?? [])])];
      first.known ??= s.known;
      return;
    }
    const merged = { ...s, operators: s.operators.map((o) => ({ ...o })), categories: [...s.categories], parcel };
    if (key) byParcel.set(key, merged);
    out.push(merged);
  });
  return out.map((s, i) => ({ ...s, ref: `S${i + 1}`, ownerUser: likelyOwnerUser(s.parcel?.owner ?? null, s.operators.map((o) => o.name)),
    identityStatus: s.parcel ? addressConflict(s.address, s.parcel.situsAddress) ? "address-conflict" as const : "parcel-matched" as const : "unverified" as const }));
}

export function matchKnownSites(sites: Site[], known: KnownPoint[]): Site[] {
  return sites.map(s => {
    const matches: Known[] = [];
    for (const k of known) {
      const distanceMi = haversineMiles(s.lat, s.lng, k.lat, k.lng);
      if (distanceMi > .25) continue;
      const a = parcelKey(s.parcel), b = parcelKey(k.parcel);
      const sameParcel = !!a && a === b;
      const sameAddress = !(a && b && a !== b) && !!addressKey(s.address) && addressKey(s.address) === addressKey(k.address ?? k.label.replace(/\s+\([^)]*\)$/, ""));
      const same = sameParcel || sameAddress;
      if (!same && distanceMi > KNOWN_MI) continue;
      matches.push({ kind: k.kind, id: k.id, label: k.label, href: k.href, distanceMi, stage: k.stage,
        match: same ? "same_property" : "nearby", evidence: sameParcel ? "parcel" : sameAddress ? "address" : "distance",
        relation: k.kind === "deal" ? ["archived", "closed"].includes(k.stage ?? "") ? "archived-deal" : "active-deal" : k.kind === "comp" ? "comp" : k.status === "owned" ? "owned-asset" : "asset" });
    }
    const priority = (k: Known) => k.relation === "active-deal" ? 0 : k.relation === "owned-asset" ? 1 : k.relation === "archived-deal" ? 2 : 3;
    const exact = matches.filter(k => k.match === "same_property").sort((a, b) => priority(a) - priority(b) || a.distanceMi - b.distanceMi);
    return { ...s, known: exact[0] ?? null, nearby: matches.filter(k => k !== exact[0]).sort((a, b) => a.distanceMi - b.distanceMi).slice(0, 5) };
  });
}

export function buildSites(center: { lat: number; lng: number }, radiusMiles: number, places: Array<Place & { category: string }>, known: KnownPoint[]): Site[] {
  const inRange = places
    .map((p) => ({ p, d: haversineMiles(center.lat, center.lng, p.geometry.location.lat, p.geometry.location.lng) }))
    .filter(({ d }) => d <= radiusMiles)
    .sort((a, b) => a.d - b.d || a.p.place_id.localeCompare(b.p.place_id));

  const sites: Site[] = [];
  for (const { p, d } of inRange) {
    const { lat, lng } = p.geometry.location;
    const categories = p.categories ?? [p.category];
    const op = { placeId: p.place_id, name: p.name, category: p.category, sourcePlaceIds: [p.place_id], categories, profileIds: p.profileIds ?? [] };
    const street = streetKey(p.vicinity);
    // Adjacent businesses at different addresses are separate properties. A
    // shared street address or county parcel combines occupiers, not identities.
    const near = sites.find((s) => s.operators.some((o) => o.placeId === p.place_id) ||
      (street !== null && streetKey(s.address) === street && haversineMiles(s.lat, s.lng, lat, lng) <= 0.25));
    if (near) {
      mergeOperator(near.operators, op);
      near.categories = [...new Set([...near.categories, ...categories])];
      near.profileIds = [...new Set([...(near.profileIds ?? []), ...(p.profileIds ?? [])])];
      continue;
    }
    sites.push({ ref: `S${sites.length + 1}`, lat, lng, address: p.vicinity ?? "", distanceMi: d, operators: [op], categories: [...categories], profileIds: [...(p.profileIds ?? [])], known: null, parcel: null, ownerUser: false });
  }
  return matchKnownSites(sites, known);
}
