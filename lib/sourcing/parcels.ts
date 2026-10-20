// lib/sourcing/parcels.ts
//
// Owner of record for a point, from the Texas statewide parcel layer (TxGIO
// StratMap Land Parcels), which republishes each county appraisal district's
// roll: owner, mailing address, situs, values, year built. One identify call
// per point, ~150 ms, no key.
//
// Two traps found probing it:
//  - DATE_ACQ is when TxGIO acquired the data (every parcel shows the same
//    2026 date), not when the owner bought the property. It is ignored.
//  - Shapes are Web Mercator, so st_area overstates ground area by 1/cos²(lat).
//    Acres are corrected; the appraisal district's legal area is kept as well.

export const PARCEL_SOURCE = "TxGIO StratMap Land Parcels (county appraisal district roll)";
const LAYER = "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer";
const SQM_PER_ACRE = 4046.8564224;

export interface Parcel {
  owner: string | null;
  ownerCareOf: string | null;
  mailingAddress: string | null;
  situsAddress: string | null;
  acres: number | null;
  legalArea: number | null;
  yearBuilt: number | null;
  marketValue: number | null;
  propId: string | null;
  county: string | null;
  source: string;
  taxYear: number | null;
  ownerClass: "public" | "institutional" | "private";
}

const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s+/g, " ").trim() : null;
  return s && s.toLowerCase() !== "null" ? s : null;
};
// County layers give numbers as numbers; the Texas layer as strings.
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(clean(v)); return Number.isFinite(n) && n > 0 ? n : null; };

// Public owners never sell like a private owner; institutional owners are
// landlords to approach differently. Everything else is a private owner.
const PUBLIC = /\b(ISD|INDEPENDENT SCHOOL|CITY OF|COUNTY OF|COUNTY|STATE OF TEXAS|STATE OF GEORGIA|TXDOT|GDOT|BOARD OF EDUCATION|GEORGIA PORTS|AUTHORITY|DISTRICT|PORT OF|UNITED STATES|USA|MUNICIPAL|UNIVERSITY|COLLEGE)\b/i;
const INSTITUTIONAL = /\b(PROLOGIS|LINK LOGISTICS|BLACKSTONE|REXFORD|EASTGROUP|STAG|DUKE REALTY|BROOKFIELD|INVESCO|CBRE|NUVEEN|ALTERRA|CATELLUS|ZENITH|CRG|REIT|PROPERTY TRUST|INDUSTRIAL PROPERTIES|PROPERTIES TRUST)\b/i;

export function classifyOwner(owner: string | null): Parcel["ownerClass"] {
  if (!owner) return "private";
  if (PUBLIC.test(owner)) return "public";
  if (INSTITUTIONAL.test(owner)) return "institutional";
  return "private";
}

// Georgia has no free statewide parcel layer, so each county assessor's own
// layer is listed with the box it covers and how its fields are named.
// Verified with a point query when added.
export type CountySource = {
  county: string;
  state: string;
  name: string;
  /** [south, north, west, east] */
  bounds: [number, number, number, number];
  layer: string;
  owner: string;
  mailing: string[];
  situs: string;
  acres?: string;
  /** Use when the layer gives area in square feet instead of acres. */
  areaSqft?: string;
  id: string;
  year?: string;
  value?: string;
};
export const COUNTY_SOURCES: CountySource[] = [
  {
    county: "Fulton", state: "GA", name: "Fulton County Tax Parcels (Board of Assessors)", bounds: [33.5, 34.19, -84.86, -84.09],
    layer: "https://gismaps.fultoncountyga.gov/arcgispub/rest/services/OpenData/Tax_Parcels/MapServer/0",
    owner: "Owner", mailing: ["OwnerAddr1", "OwnerAddr2"], situs: "Address", acres: "LandAcres", id: "ParcelID", year: "TaxYear",
  },
];

const inBox = (lat: number, lng: number, [s, n, w, e]: number[]) => lat >= s && lat <= n && lng >= w && lng <= e;
const inTexas = (lat: number, lng: number) => inBox(lat, lng, [25.8, 36.6, -106.7, -93.5]);

async function lookupCountyParcel(src: CountySource, lat: number, lng: number, fetcher: typeof fetch): Promise<Parcel | null> {
  const url = new URL(`${src.layer}/query`);
  url.search = new URLSearchParams({
    geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: "*", returnGeometry: "false", f: "json",
  }).toString();
  try {
    const r = await fetcher(url, { signal: AbortSignal.timeout(8000) } as RequestInit);
    if (!r.ok) return null;
    const a = (await r.json())?.features?.[0]?.attributes;
    if (!a) return null;
    const owner = clean(a[src.owner]);
    const acres = src.acres ? num(a[src.acres]) : src.areaSqft && num(a[src.areaSqft]) ? Math.round((num(a[src.areaSqft])! / 43560) * 100) / 100 : null;
    return {
      owner,
      ownerCareOf: null,
      mailingAddress: src.mailing.map((f) => clean(a[f])).filter(Boolean).join(", ") || null,
      situsAddress: clean(a[src.situs]),
      acres,
      legalArea: null,
      yearBuilt: null,
      marketValue: src.value ? num(a[src.value]) : null,
      propId: clean(a[src.id]),
      county: src.county,
      source: src.name,
      taxYear: src.year ? num(a[src.year]) : null,
      ownerClass: classifyOwner(owner),
    };
  } catch {
    return null;
  }
}

/**
 * Owner of record at a point: the Texas statewide layer inside Texas, else
 * the county layer covering the point (Georgia counties), else null.
 */
export async function lookupParcel(lat: number, lng: number, fetcher: typeof fetch = fetch): Promise<Parcel | null> {
  if (!inTexas(lat, lng)) {
    for (const src of COUNTY_SOURCES.filter((s) => inBox(lat, lng, s.bounds))) {
      const hit = await lookupCountyParcel(src, lat, lng, fetcher);
      if (hit) return hit;
    }
    return null;
  }
  return lookupTexasParcel(lat, lng, fetcher);
}

async function lookupTexasParcel(lat: number, lng: number, fetcher: typeof fetch): Promise<Parcel | null> {
  const d = 0.001;
  const url = new URL(`${LAYER}/identify`);
  url.search = new URLSearchParams({
    geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", sr: "4326", layers: "all:0", tolerance: "0",
    mapExtent: [lng - d, lat - d, lng + d, lat + d].join(","), imageDisplay: "400,400,96", returnGeometry: "false", f: "json",
  }).toString();
  try {
    const r = await fetcher(url, { signal: AbortSignal.timeout(8000) } as RequestInit);
    if (!r.ok) return null;
    const a = (await r.json())?.results?.[0]?.attributes;
    if (!a) return null;
    const mercatorSqm = num(a["st_area(shape)"]);
    const owner = clean(a.OWNER_NAME);
    return {
      owner,
      ownerCareOf: clean(a.NAME_CARE),
      mailingAddress: clean(a.MAIL_ADDR),
      situsAddress: clean(a.SITUS_ADDR),
      acres: mercatorSqm ? Math.round(((mercatorSqm * Math.cos((lat * Math.PI) / 180) ** 2) / SQM_PER_ACRE) * 100) / 100 : null,
      legalArea: num(a.LEGAL_AREA),
      yearBuilt: num(a.YEAR_BUILT),
      marketValue: num(a.MKT_VALUE),
      propId: clean(a.PROP_ID),
      county: clean(a.COUNTY),
      source: clean(a.SOURCE) ? `${PARCEL_SOURCE}: ${clean(a.SOURCE)}` : PARCEL_SOURCE,
      taxYear: num(a.TAX_YEAR),
      ownerClass: classifyOwner(owner),
    };
  } catch {
    return null;
  }
}

/** Look up many points with a bounded number of requests in flight. */
export async function lookupParcels<T extends { lat: number; lng: number }>(items: T[], limit = 8, fetcher: typeof fetch = fetch): Promise<Array<Parcel | null>> {
  const out: Array<Parcel | null> = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await lookupParcel(items[i].lat, items[i].lng, fetcher); }
  }));
  return out;
}

// Words that say nothing about who someone is.
const GENERIC = new Set(["llc", "inc", "ltd", "lp", "llp", "co", "corp", "company", "corporation", "the", "and", "of", "group", "holdings", "properties", "property",
  "investments", "partners", "trust", "texas", "tx", "houston", "dallas", "austin", "san", "antonio", "fort", "worth", "services", "service", "supply", "rental",
  "rentals", "equipment", "trucking", "towing", "construction", "materials", "building", "products", "paving", "fence", "real", "estate", "enterprises", "usa", "america"]);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length >= 4 && !GENERIC.has(t));

/**
 * The operator appears to own its own yard: the owner of record shares a
 * distinctive name with a business on the site ("MC CAULEY LUMBER CO" /
 * "Mc Cauley Lumber Co", "WALDREP JIMMY W" / "A Waldrep Company"). A
 * sale-leaseback lead, to be confirmed -- surnames can coincide.
 */
export function likelyOwnerUser(owner: string | null, operators: string[]): boolean {
  if (!owner) return false;
  const own = new Set(tokens(owner));
  return operators.some((name) => tokens(name).some((t) => own.has(t)));
}
