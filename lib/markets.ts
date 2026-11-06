// lib/markets.ts
//
// One spelling per metro, for deals and comps alike. Market is typed free-hand
// (and filled by the import agents), so the same place arrived as "DFW",
// "Dallas/Fort Worth", a suburb ("La Porte", "Round Rock") or a typo
// ("Hoston") -- and a deal labelled DFW matched no comp labelled Dallas or
// Fort Worth. Every write of a market goes through canonicalMarket().
//
// Dallas-Fort Worth is two markets, split the way the comps already are: by
// city, with Grand Prairie on the Dallas side. A DFW-ish label in a city not
// listed falls back to longitude (Fort Worth west of -97.15).

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/^ft /, "fort ")
    .replace(/\s+/g, " ");

const FORT_WORTH_CITIES = new Set([
  "fort worth", "arlington", "euless", "mansfield", "haltom city", "saginaw", "justin", "north richland hills",
  "n richland hills", "richland hills", "burleson", "haslet", "keller", "roanoke", "bedford", "hurst", "grapevine",
  "colleyville", "southlake", "watauga", "white settlement", "benbrook", "crowley", "everman", "forest hill",
  "kennedale", "lake worth", "azle", "weatherford", "aledo", "cleburne", "joshua", "alvarado", "granbury",
  "decatur", "rhome", "northlake", "blue mound", "river oaks", "sansom park", "westworth village",
]);
const DALLAS_CITIES = new Set([
  "dallas", "irving", "grand prairie", "garland", "hutchins", "farmers branch", "plano", "cedar hill", "carrollton",
  "carrolton", "flower mound", "frisco", "denton", "mesquite", "lancaster", "wilmer", "duncanville", "desoto",
  "coppell", "lewisville", "richardson", "rowlett", "rockwall", "mckinney", "allen", "addison", "balch springs",
  "seagoville", "forney", "terrell", "red oak", "waxahachie", "midlothian", "ennis", "sachse", "wylie", "the colony",
  "little elm", "prosper", "celina", "anna", "melissa", "princeton", "sunnyvale", "kaufman", "ferris", "palmer",
  "glenn heights", "ovilla", "highland park", "university park",
]);
const DFW_LABELS = new Set(["dfw", "dallas/fort worth", "dallas-fort worth", "dallas fort worth", "dallas–fort worth", "dallas / fort worth"]);

// Suburbs and misspellings -> metro.
const METRO_OF: Record<string, string> = {
  hoston: "Houston", houston: "Houston", "la porte": "Houston", laporte: "Houston", pearland: "Houston",
  baytown: "Houston", channelview: "Houston", "galena park": "Houston", stafford: "Houston", conroe: "Houston",
  pasadena: "Houston", katy: "Houston", "sugar land": "Houston", humble: "Houston", spring: "Houston",
  tomball: "Houston", "deer park": "Houston", "missouri city": "Houston", "jacinto city": "Houston",
  "south houston": "Houston", "league city": "Houston", "webster": "Houston", "cypress": "Houston",
  austin: "Austin", "round rock": "Austin", hutto: "Austin", pflugerville: "Austin", georgetown: "Austin",
  "cedar park": "Austin", leander: "Austin", kyle: "Austin", buda: "Austin", manor: "Austin", "san marcos": "Austin",
  "taylor": "Austin", "bastrop": "Austin",
  "san antonio": "San Antonio", "new braunfels": "San Antonio", schertz: "San Antonio", converse: "San Antonio",
  seguin: "San Antonio", "live oak": "San Antonio", selma: "San Antonio", cibolo: "San Antonio",
  // Georgia (added when Atlanta and Savannah joined the coverage).
  atlanta: "Atlanta", "metro atlanta": "Atlanta", atl: "Atlanta", marietta: "Atlanta", smyrna: "Atlanta", austell: "Atlanta",
  mableton: "Atlanta", "lithia springs": "Atlanta", douglasville: "Atlanta", "fulton industrial": "Atlanta", fairburn: "Atlanta",
  "union city": "Atlanta", "college park": "Atlanta", "east point": "Atlanta", hapeville: "Atlanta", "forest park": "Atlanta",
  morrow: "Atlanta", jonesboro: "Atlanta", riverdale: "Atlanta", ellenwood: "Atlanta", conley: "Atlanta", "stockbridge": "Atlanta",
  mcdonough: "Atlanta", "locust grove": "Atlanta", hampton: "Atlanta", fayetteville: "Atlanta", "peachtree city": "Atlanta",
  palmetto: "Atlanta", "south fulton": "Atlanta", kennesaw: "Atlanta", "acworth": "Atlanta", norcross: "Atlanta",
  "peachtree corners": "Atlanta", doraville: "Atlanta", chamblee: "Atlanta", tucker: "Atlanta", lawrenceville: "Atlanta",
  duluth: "Atlanta", suwanee: "Atlanta", buford: "Atlanta", "lilburn": "Atlanta", "stone mountain": "Atlanta",
  lithonia: "Atlanta", decatur: "Atlanta", conyers: "Atlanta", covington: "Atlanta", "social circle": "Atlanta", braselton: "Atlanta",
  savannah: "Savannah", pooler: "Savannah", "port wentworth": "Savannah", "garden city": "Savannah", bloomingdale: "Savannah",
  rincon: "Savannah", "richmond hill": "Savannah", "black creek": "Savannah", ellabell: "Savannah", guyton: "Savannah",
  springfield: "Savannah", "pembroke": "Savannah", "hinesville": "Savannah", "brooklet": "Savannah", statesboro: "Savannah",
};

// The state each market sits in, so an address is never looked up in the
// wrong one ("Savannah" exists in Texas and Georgia).
const STATE_OF: Record<string, string> = {
  houston: "TX", dallas: "TX", "fort worth": "TX", austin: "TX", "san antonio": "TX", "el paso": "TX", laredo: "TX", midland: "TX",
  atlanta: "GA", savannah: "GA", memphis: "TN", tulsa: "OK", chicago: "IL", "south florida": "FL",
};

/** Two-letter state for a market (canonical name), or null when unknown. */
export function stateOfMarket(market: unknown): string | null {
  return STATE_OF[norm(market)] ?? null;
}

function dfwSide(city: unknown, longitude?: unknown): "Dallas" | "Fort Worth" | null {
  const c = norm(city);
  if (FORT_WORTH_CITIES.has(c)) return "Fort Worth";
  if (DALLAS_CITIES.has(c)) return "Dallas";
  const lng = longitude == null || longitude === "" ? NaN : Number(longitude);
  if (Number.isFinite(lng)) return lng < -97.15 ? "Fort Worth" : "Dallas";
  return null;
}

/**
 * The metro a deal or comp belongs to, spelled one way. Unknown markets pass
 * through trimmed (Chicago, Savannah, ...). A DFW label whose side can't be
 * told from the city or longitude is returned as "Dallas", the larger side.
 */
export function canonicalMarket(market: unknown, city?: unknown, longitude?: unknown): string | null {
  const raw = String(market ?? "").trim();
  const m = norm(raw);
  if (!m) {
    // No market typed: a DFW city still says which metro it is.
    return dfwSide(city) ?? METRO_OF[norm(city)] ?? null;
  }
  if (DFW_LABELS.has(m) || m === "dallas" || m === "fort worth") {
    if (DFW_LABELS.has(m) || norm(city)) return dfwSide(city, longitude) ?? (m === "fort worth" ? "Fort Worth" : "Dallas");
    return m === "fort worth" ? "Fort Worth" : "Dallas";
  }
  if (FORT_WORTH_CITIES.has(m)) return "Fort Worth";
  if (DALLAS_CITIES.has(m)) return "Dallas";
  return METRO_OF[m] ?? raw;
}

// Metro centres, for placing a comp by its pin when nobody typed a market and
// the city isn't one we know (or is missing -- broker tables often carry a
// bare street address). Each covers MAX_METRO_MILES around it; the nearest
// wins, so Austin and San Antonio split roughly at New Braunfels / San Marcos.
const METRO_CENTERS: Array<{ market: string; lat: number; lng: number; miles?: number }> = [
  { market: "Houston", lat: 29.7604, lng: -95.3698 },
  { market: "Dallas", lat: 32.7767, lng: -96.797 },
  { market: "Fort Worth", lat: 32.7555, lng: -97.3308 },
  { market: "Austin", lat: 30.2672, lng: -97.7431 },
  // North of downtown, toward the airport / I-35 industrial belt, so New
  // Braunfels and the I-35 corridor file as San Antonio and San Marcos as Austin.
  { market: "San Antonio", lat: 29.52, lng: -98.4 },
  { market: "El Paso", lat: 31.7619, lng: -106.485 },
  { market: "Laredo", lat: 27.5306, lng: -99.4803 },
  { market: "Midland", lat: 31.9973, lng: -102.0779 },
  { market: "Atlanta", lat: 33.749, lng: -84.388 },
  { market: "Savannah", lat: 32.0809, lng: -81.0912 },
  { market: "Memphis", lat: 35.1495, lng: -90.049 },
  { market: "Tulsa", lat: 36.154, lng: -95.9928 },
  { market: "Chicago", lat: 41.8781, lng: -87.6298 },
  // Miami to West Palm Beach, centred on Fort Lauderdale.
  { market: "South Florida", lat: 26.1224, lng: -80.1373, miles: 75 },
];
const MAX_METRO_MILES = 65;

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * The metro a pin sits in: the nearest metro centre within its reach, with
 * Dallas vs Fort Worth decided the usual way (city, then longitude). Null
 * outside every metro we cover -- a comp in the country stays unlabelled
 * rather than filed under the nearest city 200 miles off.
 */
export function marketAt(latitude: unknown, longitude: unknown, city?: unknown): string | null {
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return null;
  const lat = Number(latitude), lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: { market: string; d: number } | null = null;
  for (const c of METRO_CENTERS) {
    const d = milesBetween(lat, lng, c.lat, c.lng);
    if (d <= (c.miles ?? MAX_METRO_MILES) && (!best || d < best.d)) best = { market: c.market, d };
  }
  if (!best) return null;
  if (best.market === "Dallas" || best.market === "Fort Worth") return dfwSide(city, lng) ?? best.market;
  return best.market;
}

/**
 * The market to store for a comp: what was typed (spelled one way), else what
 * the city says, else where the pin is. Nobody has to type it.
 */
export function resolveMarket(market: unknown, city: unknown, latitude: unknown, longitude: unknown): string | null {
  return canonicalMarket(market, city, longitude) ?? marketAt(latitude, longitude, city);
}

/** Escalation as a fraction: 3 or "3%" -> 0.03, 0.035 stays. Null when unreadable. */
export function escalationFraction(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const n = Number(s.replace(/[%,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  const f = s.endsWith("%") || n >= 0.5 ? n / 100 : n;
  return Number(f.toFixed(6));
}
