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
};

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

/** Escalation as a fraction: 3 or "3%" -> 0.03, 0.035 stays. Null when unreadable. */
export function escalationFraction(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const n = Number(s.replace(/[%,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  const f = s.endsWith("%") || n >= 0.5 ? n / 100 : n;
  return Number(f.toFixed(6));
}
