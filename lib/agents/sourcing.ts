// Content contract for the off-market sourcing agent: for each swept yard
// site, who owns the parcel, what it is, why it might trade, whether it fits
// the buy box, and a first outreach draft. Shared by the prompt, the worker's
// check of the returned report, the sourcing page and the add-prospect route.

export const SOURCING_VERSION = "sourcing-v1";
export const MAX_SOURCING_SITES = 10;
const OWNER_TYPES = ["owner-user", "private investor", "institutional", "public", "unknown"] as const;
const STORAGE = ["permitted", "conditional", "not permitted", "unverified"] as const;
const FIT = ["strong", "possible", "poor", "unknown"] as const;

export interface SourcedSite {
  ref: string;
  parcelAddress: string | null;
  city: string | null;
  county: string | null;
  parcelId: string | null;
  owner: string | null;
  ownerMailingAddress: string | null;
  ownerType: (typeof OWNER_TYPES)[number];
  acres: number | null;
  buildingSf: number | null;
  yearBuilt: number | null;
  ownedSince: string | null;
  occupant: string | null;
  zoning: string | null;
  outdoorStorage: (typeof STORAGE)[number];
  signals: string[];
  fit: (typeof FIT)[number];
  fitReason: string;
  outreach: string;
  sources: string[];
  unverified: string[];
  usableAcres?: number | null;
  buildingFootprintSf?: number | null;
  fieldSources?: Record<string, string>;
}
export interface SourcingReport { version: typeof SOURCING_VERSION; sites: SourcedSite[] }

const str = (v: unknown, n: number) => (v === null || v === undefined ? null : typeof v === "string" && v.length <= n ? v.trim() || null : undefined);
const numOrNull = (v: unknown, max: number) => (v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);
const list = (a: unknown, count: number, len: number): string[] | undefined =>
  a === undefined ? [] : Array.isArray(a) && a.length <= count && a.every((s) => typeof s === "string" && s.trim() && s.length <= len) ? a : undefined;

export function parseSourcing(text: string, expectedRefs?: string[], strict = false): SourcingReport | null {
  try {
    const d = JSON.parse(text);
    if (!d || d.version !== SOURCING_VERSION || !Array.isArray(d.sites) || !d.sites.length || d.sites.length > MAX_SOURCING_SITES) return null;
    if (expectedRefs && (d.sites.length !== expectedRefs.length || new Set(expectedRefs).size !== expectedRefs.length)) return null;
    const seen = new Set<string>();
    const sites: SourcedSite[] = [];
    for (const s of d.sites) {
      if (!s || typeof s.ref !== "string" || !/^S\d{1,3}$/.test(s.ref)) return null;
      if (expectedRefs && !expectedRefs.includes(s.ref)) return null;
      if (seen.has(s.ref)) return null;
      seen.add(s.ref);
      const out = {
        ref: s.ref,
        parcelAddress: str(s.parcelAddress, 200), city: str(s.city, 80), county: str(s.county, 80), parcelId: str(s.parcelId, 80),
        owner: str(s.owner, 200), ownerMailingAddress: str(s.ownerMailingAddress, 250),
        ownerType: OWNER_TYPES.includes(s.ownerType) ? s.ownerType : undefined,
        acres: numOrNull(s.acres, 1000), buildingSf: numOrNull(s.buildingSf, 5_000_000), yearBuilt: numOrNull(s.yearBuilt, 2100),
        ownedSince: str(s.ownedSince, 40), occupant: str(s.occupant, 200), zoning: str(s.zoning, 200),
        outdoorStorage: STORAGE.includes(s.outdoorStorage) ? s.outdoorStorage : undefined,
        signals: list(s.signals, 6, 240), fit: FIT.includes(s.fit) ? s.fit : undefined,
        fitReason: typeof s.fitReason === "string" && s.fitReason.length <= 400 ? s.fitReason.trim() : undefined,
        outreach: typeof s.outreach === "string" && s.outreach.length <= 1500 ? s.outreach.trim() : undefined,
        sources: list(s.sources, 10, 500), unverified: list(s.unverified, 8, 300),
        usableAcres: numOrNull(s.usableAcres, 1000), buildingFootprintSf: numOrNull(s.buildingFootprintSf, 5_000_000),
        fieldSources: s.fieldSources ?? {},
      };
      if (Object.values(out).some((v) => v === undefined)) return null;
      // Owner and parcel facts are only worth anything with a source.
      if ((out.owner || out.parcelId || out.acres !== null) && !out.sources!.length) return null;
      const urlOf = (value: string) => {
        const match = value.match(/https?:\/\/[^\s)]+/); if (!match) return null;
        try { const u = new URL(match[0]); return !u.username && !u.password && u.hostname.includes(".") ? u.href : null; } catch { return null; }
      };
      if (out.sources!.some(value => !urlOf(value))) return null;
      if (!out.fieldSources || typeof out.fieldSources !== "object" || Array.isArray(out.fieldSources) || Object.keys(out.fieldSources).length > 20) return null;
      const urls = new Set(out.sources!.map(urlOf));
      for (const value of Object.values(out.fieldSources)) if (typeof value !== "string" || !urlOf(value) || !urls.has(urlOf(value))) return null;
      if (strict) {
        if (out.sources!.some(value => !/\b20\d{2}-\d{2}-\d{2}\b/.test(value))) return null;
        for (const key of ["parcelAddress", "city", "county", "parcelId", "owner", "ownerMailingAddress", "acres", "buildingSf", "yearBuilt", "ownedSince", "occupant", "zoning", "usableAcres", "buildingFootprintSf"] as const) {
          if (out[key] != null && !out.fieldSources[key]) return null;
        }
        if (out.outdoorStorage !== "unverified" && !out.fieldSources.outdoorStorage) return null;
        if (out.ownerType === "owner-user" && !out.fieldSources.ownerRelationship) return null;
      }
      if (out.usableAcres != null && out.acres != null && out.usableAcres > out.acres) return null;
      sites.push(out as SourcedSite);
    }
    return { version: SOURCING_VERSION, sites };
  } catch {
    return null;
  }
}

export const SOURCING_INSTRUCTIONS = `You are qualifying off-market industrial outdoor storage (IOS) acquisition targets. The supplied text is JSON with a buy box and up to ${MAX_SOURCING_SITES} sites, each a location where businesses that operate outdoor yards (trucking, equipment rental, contractors, container storage, building materials and similar) were found on Google Maps. None is known to be for sale.
Most sites include a public parcel record. Verify the parcel against its cited county/assessor URL. ownerUser=true is ONLY an unverified name similarity, never proof of common ownership. Public ownership overrides any name similarity. Resolve identityStatus=address-conflict before asserting occupants or parcel facts. Separate total parcel acres from usableAcres (usable outdoor yard after restrictions) and buildingSf (floor area) from buildingFootprintSf (footprint). Unknown measurements stay null. A site with a "usable" field carries net usable acres Hopper measured from the parcel outline (less building footprints, the FEMA 100-year floodplain and NWI wetlands; easements, setbacks and slope not checked); the server uses it for fit, so do not restate it as usableAcres, but list any easement, site-plan or survey evidence that contradicts it under unverified. Research current ownership relationships, deed dates, occupancy, zoning and storage permission from authoritative public evidence.
For each site, use web search to research public records, preferring the county appraisal district (for Texas: HCAD, DCAD, TAD, TCAD, BCAD, FBCAD, MCAD and similar), county clerk deed records, the municipality's zoning map and ordinance, the Texas Comptroller and Secretary of State entity searches, and the operator's own website. Identify the parcel the operators occupy, its owner of record and owner mailing address, parcel ID, land acres, building SF, year built, when the current owner acquired it, and zoning / whether outdoor storage is permitted.
Classify ownerType: "owner-user" (the operator or its principals own it, a sale-leaseback candidate), "private investor", "institutional", "public", or "unknown". List off-market signals, e.g. long hold, owner-user operating business, individual or family entity owner, out-of-area owner mailing address, aging improvements, low building coverage, estate or trust ownership. Judge fit against the buy box (usable acres and building coverage) as "strong", "possible", "poor" or "unknown", with a one-sentence reason.
Draft a short, professional first-touch letter from Dalfen Industrial to the owner of record expressing interest in acquiring the property (or a sale-leaseback if owner-user). No price, no promises, no invented names or facts, under 1,200 characters. It will be reviewed and is never sent automatically.
The outer response is JSON {report,model,limitations}. report must be a STRING containing serialized JSON (no Markdown fences) with this shape:
{"version":"${SOURCING_VERSION}","sites":[{"ref":"S1","parcelAddress":null,"city":null,"county":null,"parcelId":null,"owner":null,"ownerMailingAddress":null,"ownerType":"unknown","acres":null,"buildingSf":null,"yearBuilt":null,"ownedSince":null,"occupant":null,"zoning":null,"outdoorStorage":"unverified","signals":[],"fit":"unknown","fitReason":"","outreach":"","sources":[],"unverified":[]}]}
Use each supplied site's ref exactly once; include every supplied site, in order. Add usableAcres:null, buildingFootprintSf:null and fieldSources:{} to each site. fieldSources maps EACH non-null factual field's exact key (including owner, parcelAddress, city, county, parcelId, acres, buildingSf, yearBuilt, ownedSince, occupant, zoning and ownerMailingAddress) to its supporting http(s) URL. The same URL must appear in sources with an accessed date in YYYY-MM-DD form. Non-unverified outdoorStorage needs a fieldSources.outdoorStorage URL; ownerType=owner-user needs fieldSources.ownerRelationship proving a current ownership relationship, beyond name similarity. Any fact you cannot source stays null and goes in unverified. Server rules will calculate final fit; never infer usable acres from total land or footprint from floor area. outdoorStorage is one of "permitted", "conditional", "not permitted", "unverified". Limits: 6 signals of 240 characters, 10 sources of 500, 8 unverified of 300. Plain text only.
Do not contact anyone, submit forms, or log in to any site. A business listing is not proof of land ownership; an owner name must come from the appraisal district or deed records.`;
