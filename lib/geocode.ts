// lib/geocode.ts
//
// Address -> coordinates, with the precision reported rather than assumed.
//
// The precision matters more than it looks. Google's geocoder always answers:
// for an address it can't resolve it returns the city or ZIP centroid flagged
// APPROXIMATE, and a comp two miles away then scores as if it were next door.
// Callers get the precision so they can refuse to use a centroid for distance.

export type GeocodePrecision =
  | "rooftop"
  | "range_interpolated"
  | "geometric_center"
  | "approximate";

export interface GeocodeResult {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  formatted: string;
}

const PRECISION: Record<string, GeocodePrecision> = {
  ROOFTOP: "rooftop",
  RANGE_INTERPOLATED: "range_interpolated",
  GEOMETRIC_CENTER: "geometric_center",
  APPROXIMATE: "approximate",
};

/** Precise enough to measure distance against. A centroid is not. */
export function isUsableForDistance(precision: string | null | undefined): boolean {
  return precision === "rooftop" || precision === "range_interpolated" || precision === "geometric_center";
}

/**
 * Geocode an address from its parts. Blank parts are dropped, so callers can
 * pass address/city/market without checking which they have -- broker comp
 * tables carry a bare street address and the city comes from context.
 */
export async function geocodeAddress(
  parts: (string | null | undefined)[],
  opts: { state?: string } = {}
): Promise<GeocodeResult | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  const state = opts.state ?? "TX";
  const query = [...parts.filter(Boolean), state].join(", ");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", `country:US|administrative_area:${state}`);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) return null;
    const best = data.results[0];
    return {
      lat: best.geometry.location.lat,
      lng: best.geometry.location.lng,
      precision: PRECISION[best.geometry.location_type] ?? "approximate",
      formatted: best.formatted_address,
    };
  } catch {
    // A comp that can't be geocoded is still a comp worth keeping -- it just
    // can't take part in distance scoring.
    return null;
  }
}

/** Geocode many addresses with a bounded number of requests in flight. */
export async function geocodeMany<T>(
  items: T[],
  toParts: (item: T) => (string | null | undefined)[],
  limit = 5
): Promise<(GeocodeResult | null)[]> {
  const out: (GeocodeResult | null)[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await geocodeAddress(toParts(items[i]));
      }
    })
  );
  return out;
}
