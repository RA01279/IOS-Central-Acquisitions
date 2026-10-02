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
}
export interface SourcingReport { version: typeof SOURCING_VERSION; sites: SourcedSite[] }

const str = (v: unknown, n: number) => (v === null || v === undefined ? null : typeof v === "string" && v.length <= n ? v.trim() || null : undefined);
const numOrNull = (v: unknown, max: number) => (v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);
const list = (a: unknown, count: number, len: number): string[] | undefined =>
  a === undefined ? [] : Array.isArray(a) && a.length <= count && a.every((s) => typeof s === "string" && s.trim() && s.length <= len) ? a : undefined;

export function parseSourcing(text: string, expectedRefs?: string[]): SourcingReport | null {
  try {
    const d = JSON.parse(text);
    if (!d || d.version !== SOURCING_VERSION || !Array.isArray(d.sites) || d.sites.length > MAX_SOURCING_SITES) return null;
    const sites: SourcedSite[] = [];
    for (const s of d.sites) {
      if (!s || typeof s.ref !== "string" || !/^S\d{1,3}$/.test(s.ref)) return null;
      if (expectedRefs && !expectedRefs.includes(s.ref)) return null;
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
      };
      if (Object.values(out).some((v) => v === undefined)) return null;
      // Owner and parcel facts are only worth anything with a source.
      if ((out.owner || out.parcelId || out.acres !== null) && !out.sources!.length) return null;
      sites.push(out as SourcedSite);
    }
    return { version: SOURCING_VERSION, sites };
  } catch {
    return null;
  }
}

export const SOURCING_INSTRUCTIONS = `You are qualifying off-market industrial outdoor storage (IOS) acquisition targets. The supplied text is JSON with a buy box and up to ${MAX_SOURCING_SITES} sites, each a location where businesses that operate outdoor yards (trucking, equipment rental, contractors, container storage, building materials and similar) were found on Google Maps. None is known to be for sale.
Most sites include a parcel record from the Texas statewide parcel layer (TxGIO StratMap Land Parcels, republished from the county appraisal district roll): owner of record, mailing address, situs address, acres, year built, market value and property ID. Treat it as the owner-of-record source and cite it exactly as given in its "source" field with the tax year. ownerUser=true means the owner name matches an operator, a sale-leaseback lead to confirm. Spend research on what the parcel record cannot tell you: whether the listed operators actually occupy this parcel, who is behind the owning entity (principals, related companies, whether it is the operator), how long it has been held (deed records; the parcel layer has no purchase date), zoning or deed restrictions on outdoor storage, and building size and coverage.
For each site, use web search to research public records, preferring the county appraisal district (for Texas: HCAD, DCAD, TAD, TCAD, BCAD, FBCAD, MCAD and similar), county clerk deed records, the municipality's zoning map and ordinance, the Texas Comptroller and Secretary of State entity searches, and the operator's own website. Identify the parcel the operators occupy, its owner of record and owner mailing address, parcel ID, land acres, building SF, year built, when the current owner acquired it, and zoning / whether outdoor storage is permitted.
Classify ownerType: "owner-user" (the operator or its principals own it, a sale-leaseback candidate), "private investor", "institutional", "public", or "unknown". List off-market signals, e.g. long hold, owner-user operating business, individual or family entity owner, out-of-area owner mailing address, aging improvements, low building coverage, estate or trust ownership. Judge fit against the buy box (usable acres and building coverage) as "strong", "possible", "poor" or "unknown", with a one-sentence reason.
Draft a short, professional first-touch letter from Dalfen Industrial to the owner of record expressing interest in acquiring the property (or a sale-leaseback if owner-user). No price, no promises, no invented names or facts, under 1,200 characters. It will be reviewed and is never sent automatically.
The outer response is JSON {report,model,limitations}. report must be a STRING containing serialized JSON (no Markdown fences) with this shape:
{"version":"${SOURCING_VERSION}","sites":[{"ref":"S1","parcelAddress":null,"city":null,"county":null,"parcelId":null,"owner":null,"ownerMailingAddress":null,"ownerType":"unknown","acres":null,"buildingSf":null,"yearBuilt":null,"ownedSince":null,"occupant":null,"zoning":null,"outdoorStorage":"unverified","signals":[],"fit":"unknown","fitReason":"","outreach":"","sources":[],"unverified":[]}]}
Use each supplied site's ref exactly; include every supplied site, in order. Every fact must be supported by a listed source URL with accessed date; anything you could not confirm stays null and goes in unverified. outdoorStorage is one of "permitted", "conditional", "not permitted", "unverified". Limits: 6 signals of 240 characters, 10 sources of 500, 8 unverified of 300. Plain text only.
Do not contact anyone, submit forms, or log in to any site. A business listing is not proof of land ownership; an owner name must come from the appraisal district or deed records.`;
