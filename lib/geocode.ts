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

// -- working out which state an address is in ------------------------------

const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};

/** A user-supplied state, in any spelling, as a two-letter code. */
export function normaliseState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATE_NAMES[s.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/**
 * Find the state named in an address, city or market string.
 *
 * Deliberately strict, because a WRONG state is far worse than no state: it
 * becomes a hard filter on the lookup, and Google will happily return the
 * centroid of the state you asked for rather than admit it found nothing.
 *
 * So a match only counts when a comma-separated segment IS the state --
 * "Savannah, GA" and "2025 Louisville Road, Savannah, Georgia" both resolve,
 * while these do not:
 *
 *   "316 Georgia Avenue"   a street named after a state, in Houston
 *   "3612 LA Salle Dr"     "LA" is Louisiana's code and also half a street name
 *   "Washington Blvd"      same problem
 *
 * Two-letter codes must also have been written in capitals, which is how
 * anybody writes a state and not how anybody writes a preposition.
 *
 * Later parts win over earlier ones: callers pass address first and market
 * last, and "Savannah, GA" in the market field is better evidence than
 * something that merely looks like a state inside a street address.
 */
export function resolveState(parts: (string | null | undefined)[]): string | null {
  let found: string | null = null;
  for (const part of parts) {
    if (!part) continue;
    for (const rawSegment of String(part).split(",")) {
      const segment = rawSegment.trim();
      if (!segment) continue;
      // A bare code, as written: "GA", not "ga" and not "Ga".
      if (segment.length === 2 && segment === segment.toUpperCase() && STATE_CODES.has(segment)) {
        found = segment;
        continue;
      }
      // A full name occupying the whole segment. "Georgia" alone is a state;
      // "Georgia Avenue" is a street.
      const named = STATE_NAMES[segment.toLowerCase().replace(/\s+/g, " ")];
      if (named) found = named;
    }
  }
  return found;
}

/**
 * Precise enough to measure distance against. A centroid is not.
 *
 * "supplied" belongs here: those are coordinates that came with the source
 * file, placed by whoever built it -- in the standard IOS comp set, at the
 * yard rather than at a street centroid. Leaving it out marked all 282 of
 * those comps unusable for distance the moment they were saved, which is the
 * exact opposite of why their coordinates are kept in preference to a geocode.
 */
export function isUsableForDistance(precision: string | null | undefined): boolean {
  return (
    precision === "rooftop" ||
    precision === "range_interpolated" ||
    precision === "geometric_center" ||
    precision === "supplied" ||
    // Pinned by a person, for the addresses that will never geocode --
    // build-to-suits with no street number, intersections, stubs.
    precision === "manual"
  );
}

/**
 * Geocode an address from its parts. Blank parts are dropped, so callers can
 * pass address/city/market without checking which they have -- broker comp
 * tables carry a bare street address and the city comes from context.
 */
export async function geocodeAddress(
  parts: (string | null | undefined)[],
  opts: { state?: string | null } = {}
): Promise<GeocodeResult | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  // The state is DERIVED, never assumed.
  //
  // This used to read `opts.state ?? "TX"`, and no caller ever passed a state
  // -- so every address in the system was appended with ", TX" and restricted
  // with administrative_area:TX. That component filter is a hard restriction
  // rather than a tiebreak: Google physically cannot return a result outside
  // it. A rent roll at 2025 Louisville Road, Savannah, GEORGIA resolved to
  // Savannah, Texas for one suite and to the geographic centre of Texas for
  // the other eight -- about 800 miles out, and plotted there on every map.
  //
  // When the state can't be determined, nothing is appended and nothing is
  // restricted. An unconstrained lookup that has to guess between two
  // Savannahs is a far smaller error than one confidently locked to the wrong
  // state, and the returned precision already tells callers how much to trust
  // the answer.
  const state = normaliseState(opts.state) ?? resolveState(parts);
  const query = [...parts.filter(Boolean), state].filter(Boolean).join(", ");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set(
    "components",
    state ? `country:US|administrative_area:${state}` : "country:US"
  );
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

/**
 * Geocode many addresses with a bounded number of requests in flight.
 *
 * `toState` lets a caller hand over a state it already knows -- a comp's own
 * State column beats anything inferred from an address string.
 */
export async function geocodeMany<T>(
  items: T[],
  toParts: (item: T) => (string | null | undefined)[],
  limit = 5,
  toState?: (item: T) => string | null | undefined
): Promise<(GeocodeResult | null)[]> {
  const out: (GeocodeResult | null)[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await geocodeAddress(toParts(items[i]), {
          state: toState ? toState(items[i]) : null,
        });
      }
    })
  );
  return out;
}
