// lib/locate-site.ts
//
// Locate one site -- New deal > Portfolio OM, comp intake, the location
// check on any form -- retrying before giving up. Brokers spell addresses
// however they like ("80 N FM 3083 Rd East"), so after the exact lookup this
// tries, in order, stopping at the first match:
//   1. the address with direction words abbreviated (East -> E, North -> N)
//   2. a Google Places Text Search for "address, city, state" (same number,
//      street and city)
//   3. the road alone, direction / street type / house number dropped
//      ("FM 3083, Conroe, TX") -- a ROAD-LEVEL pin, stored as "approximate"
//      and labelled so, never passed off as the building
// Places runs before the road on purpose: on comp addresses it finds the
// street number (1420 Rankin Rd, 8811 W Little York Rd) where the road-only
// try would drop the pin anywhere along a road miles long.
// When nothing matches, the reason Google gave for each try comes back.

import { geocodeDetailed, normaliseState, resolveState, streetKey } from "./geocode";

export interface SiteQuery {
  address: string;
  city?: string | null;
  state?: string | null;
  market?: string | null;
}

export type SiteLocation =
  | { found: true; latitude: number; longitude: number; precision: string; matchedAddress: string; via: "address" | "abbreviated" | "road" | "places"; note: string | null }
  | { found: false; reason: string };

const DIRECTIONS: Record<string, string> = { north: "N", south: "S", east: "E", west: "W", northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW" };

/** "80 North FM 3083 Rd East" -> "80 N FM 3083 Rd E". */
export function abbreviateDirections(address: string): string {
  return address.replace(/\b(north|south|east|west|northeast|northwest|southeast|southwest)\b/gi, (w) => DIRECTIONS[w.toLowerCase()]);
}

/** "80 N FM 3083 Rd East" -> "FM 3083": no house number, direction or street type. */
export function roadOnly(address: string): string {
  return address
    .split(",")[0]
    .replace(/^\s*\d+[A-Za-z]?(?:\s*[-–&]\s*\d+[A-Za-z]?)?\s+/, "")
    .replace(/\b(north|south|east|west|northeast|northwest|southeast|southwest|n|s|e|w|ne|nw|se|sw)\b\.?/gi, " ")
    .replace(/\b(lane|ln|road|rd|street|st|drive|dr|boulevard|blvd|avenue|ave|court|ct|parkway|pkwy|circle|cir|way|place|pl|trail|trl)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sameCity = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();

async function placesTextSearch(q: SiteQuery, state: string | null): Promise<SiteLocation> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { found: false, reason: "no Google key" };
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", [q.address, q.city, state].filter(Boolean).join(", "));
  url.searchParams.set("region", "us");
  url.searchParams.set("key", key);
  try {
    const data = await (await fetch(url.toString(), { signal: AbortSignal.timeout(8000) })).json();
    if (data.status !== "OK" || !data.results?.length) return { found: false, reason: data.status === "ZERO_RESULTS" ? "no place found" : `lookup failed (${data.status})` };
    const best = data.results[0];
    const formatted: string = best.formatted_address ?? "";
    // The same building: its street number and street, and the city when known.
    const number = q.address.match(/^\s*(\d+[A-Za-z]?)\b/)?.[1];
    const first = formatted.split(",")[0] ?? "";
    const gotNumber = first.match(/^\s*(\d+[A-Za-z]?)\b/)?.[1];
    const city = formatted.split(",")[1]?.trim();
    if (!number || gotNumber?.toLowerCase() !== number.toLowerCase()) return { found: false, reason: `best match was ${formatted || best.name}` };
    if (streetKey(first.replace(/^\s*\d+[A-Za-z]?\s+/, "")) !== streetKey(q.address.split(",")[0].replace(/^\s*\d+[A-Za-z]?\s+/, ""))) {
      return { found: false, reason: `best match was on another street: ${formatted}` };
    }
    if (!sameCity(q.city, city)) return { found: false, reason: `best match was in ${city}` };
    // A premise or business is the building itself; a bare street address is
    // Google's position for that number along the street (interpolated).
    const types: string[] = best.types ?? [];
    const precision = types.some((t) => t === "premise" || t === "establishment") ? "geometric_center" : types.includes("street_address") ? "range_interpolated" : "approximate";
    return {
      found: true, latitude: best.geometry.location.lat, longitude: best.geometry.location.lng,
      precision, matchedAddress: formatted, via: "places",
      note: precision === "range_interpolated" ? "Found with Google Places search, at the street number" : "Found with Google Places search",
    };
  } catch {
    return { found: false, reason: "no answer (timeout or network error)" };
  }
}

export async function locateSite(q: SiteQuery): Promise<SiteLocation> {
  const state = normaliseState(q.state) ?? resolveState([q.address, q.city, q.market]);
  const tries: string[] = [];
  const precise = async (address: string, via: "address" | "abbreviated", note: string | null): Promise<SiteLocation | null> => {
    const out = await geocodeDetailed([address, q.city, q.market], { state, requirePrecise: true });
    if (out.result) return { found: true, latitude: out.result.lat, longitude: out.result.lng, precision: out.result.precision, matchedAddress: out.result.formatted, via, note };
    tries.push(`${via === "address" ? "As written" : `As "${address}"`}: ${out.reason}`);
    return null;
  };

  const exact = await precise(q.address, "address", null);
  if (exact) return exact;

  const abbreviated = abbreviateDirections(q.address);
  if (abbreviated !== q.address) {
    const hit = await precise(abbreviated, "abbreviated", `Matched as "${abbreviated}"`);
    if (hit) return hit;
  }

  const places = await placesTextSearch(q, state);
  if (places.found) return places;
  tries.push(`Places search: ${places.reason}`);

  const road = roadOnly(q.address);
  if (road && q.city && road.toLowerCase() !== q.address.trim().toLowerCase()) {
    const out = await geocodeDetailed([road, q.city], { state });
    const r = out.result;
    // A road, in the right city -- not the city's centre, which Google
    // returns when it doesn't know the road.
    if (r && r.types?.includes("route") && streetKey(r.formatted.split(",")[0]) === streetKey(road) && r.formatted.toLowerCase().includes(String(q.city).toLowerCase())) {
      return {
        found: true, latitude: r.lat, longitude: r.lng, precision: "approximate", matchedAddress: r.formatted, via: "road",
        note: `Road-level only: placed on ${road} in ${q.city}, not at the building. Check the pin.`,
      };
    }
    tries.push(`As "${road}, ${q.city}": ${out.reason ?? (r?.types?.includes("route") ? `matched ${r.formatted}, not ${road} in ${q.city}` : `Google found only ${r?.formatted}, not the road`)}`);
  }

  return { found: false, reason: tries.join(" · ") };
}

/** locateSite for many sites, a few requests in flight at a time, results in order. */
export async function locateMany<T>(items: T[], toQuery: (item: T) => SiteQuery, limit = 4): Promise<SiteLocation[]> {
  const out: SiteLocation[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await locateSite(toQuery(items[i]));
      }
    })
  );
  return out;
}
