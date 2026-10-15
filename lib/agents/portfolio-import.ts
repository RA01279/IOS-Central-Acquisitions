// lib/agents/portfolio-import.ts
//
// The "portfolio-import" agent: read one section of a portfolio OM and return
// every site in its property schedule. A national OM runs past what one agent
// call can read, so the caller sends it in sections and merges the sites with
// mergePortfolioImports. Client-safe; the agent only DRAFTS -- a person
// reviews the sites and clicks Create, and nothing is written from its output.

export interface PortfolioSite {
  address: string;
  city: string | null;
  state: string | null;
  market: string | null;
  acres: number | null;
  buildingSf: number | null;
  /** The price the OM allocates to this site. */
  askingPrice: number | null;
  occupancy: "vacant" | "occupied" | null;
  waltYears: number | null;
  tenancy: "single_tenant" | "multi_tenant" | null;
  assetClass: "ios" | "industrial" | null;
  tenant: string | null;
  /** OM page the site's row was read from, for checking. */
  page: number | null;
}

export interface PortfolioImport {
  portfolio: {
    name: string | null;
    sellerBroker: string | null;
    currentOwner: string | null;
    /** The package price, when the OM states one. */
    totalPrice: number | null;
  };
  sites: PortfolioSite[];
  notes: string[];
}

export const MAX_PORTFOLIO_SITES = 300;

export const PORTFOLIO_IMPORT_INSTRUCTIONS = `Read the supplied section of a portfolio offering memorandum (OM) -- one offering of many industrial / industrial outdoor storage (IOS) properties -- and list EVERY property site in it. The source may be only part of the OM (it says which pages). The report field MUST be a serialized JSON object, nothing else, with exactly this shape:
{"portfolio":{"name":string|null,"sellerBroker":string|null,"currentOwner":string|null,"totalPrice":number|null},"sites":[{"address":string,"city":string|null,"state":string|null,"market":string|null,"acres":number|null,"buildingSf":number|null,"askingPrice":number|null,"occupancy":"vacant"|"occupied"|null,"waltYears":number|null,"tenancy":"single_tenant"|"multi_tenant"|null,"assetClass":"ios"|"industrial"|null,"tenant":string|null,"page":number|null}],"notes":[string]}
Rules:
- One entry per distinct property site, usually from the property schedule / rent roll / site summary table. A site described in several places is ONE entry; combine what each place says. Do not list the seller's offices, comparable properties, or market statistics as sites.
- address = street address only (no city/state/zip). state = 2-letter code. market = the metro (e.g. "Houston", "Dallas", "Atlanta", "Phoenix", "Inland Empire"), not the submarket.
- acres = land area in acres (convert from SF: divide by 43,560). buildingSf = building square feet. Plain numbers, no units or commas.
- askingPrice = the price the OM ALLOCATES to that site, in dollars. If the OM gives only a package price, leave every site null and put the package price in portfolio.totalPrice. Never derive a price from cap rates, rents, or per-SF figures.
- occupancy "occupied" when a tenant or in-place lease is stated, "vacant" when delivered vacant. waltYears = that site's remaining lease term in years if stated. tenant = the tenant's name if stated.
- assetClass "ios" when the site is primarily an outdoor storage yard (truck/trailer/equipment yard, large paved or stabilized yard with a small building), else "industrial".
- page = the [Page N] marker the site's row appears under.
- portfolio.name = the offering's name (e.g. "Project Atlas"). sellerBroker = listing broker name(s) and firm. currentOwner = the seller entity if named.
- Unknown stays null; never guess. Put conflicting figures, sites you could not fully read, and totals that don't add up in notes. If this section contains no sites, return an empty sites array.`;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : null);

/** Strict parse of one section's report; null when it isn't the contract. */
export function parsePortfolioImport(report: string): PortfolioImport | null {
  let raw: any;
  try {
    raw = JSON.parse(report.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sites)) return null;
  const p = raw.portfolio && typeof raw.portfolio === "object" ? raw.portfolio : {};
  const sites: PortfolioSite[] = [];
  for (const s of raw.sites.slice(0, MAX_PORTFOLIO_SITES)) {
    if (!s || typeof s !== "object") continue;
    const address = str(s.address);
    if (!address) continue;
    sites.push({
      address,
      city: str(s.city, 80),
      state: str(s.state, 2)?.toUpperCase() ?? null,
      market: str(s.market, 80),
      acres: num(s.acres),
      buildingSf: num(s.buildingSf),
      askingPrice: num(s.askingPrice),
      occupancy: pick(s.occupancy, ["vacant", "occupied"] as const),
      waltYears: num(s.waltYears),
      tenancy: pick(s.tenancy, ["single_tenant", "multi_tenant"] as const),
      assetClass: pick(s.assetClass, ["ios", "industrial"] as const),
      tenant: str(s.tenant, 120),
      page: num(s.page),
    });
  }
  return {
    portfolio: { name: str(p.name), sellerBroker: str(p.sellerBroker), currentOwner: str(p.currentOwner), totalPrice: num(p.totalPrice) },
    sites,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n: unknown) => typeof n === "string").slice(0, 20).map((n: string) => n.slice(0, 400)) : [],
  };
}

/** Street address and city, normalised enough to match one site read from two sections. */
export function siteKey(s: { address: string; city: string | null }): string {
  const norm = (v: string) => v.toLowerCase().replace(/[.,#]/g, " ")
    .replace(/\b(street|st)\b/g, "st").replace(/\b(road|rd)\b/g, "rd").replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(avenue|ave)\b/g, "ave").replace(/\b(boulevard|blvd)\b/g, "blvd").replace(/\b(highway|hwy)\b/g, "hwy")
    .replace(/\s+/g, " ").trim();
  return `${norm(s.address)}|${norm(s.city ?? "")}`;
}

/**
 * The sections' results as one portfolio. A site read in two sections is one
 * site, each field taken from whichever section stated it first. Package
 * fields likewise. Notes are kept from every section.
 */
export function mergePortfolioImports(parts: PortfolioImport[]): PortfolioImport {
  const out: PortfolioImport = { portfolio: { name: null, sellerBroker: null, currentOwner: null, totalPrice: null }, sites: [], notes: [] };
  const byKey = new Map<string, PortfolioSite>();
  for (const part of parts) {
    for (const k of Object.keys(out.portfolio) as (keyof PortfolioImport["portfolio"])[]) {
      if (out.portfolio[k] == null && part.portfolio[k] != null) (out.portfolio as any)[k] = part.portfolio[k];
    }
    for (const s of part.sites) {
      const key = siteKey(s);
      const seen = byKey.get(key);
      if (!seen) {
        const copy = { ...s };
        byKey.set(key, copy);
        out.sites.push(copy);
        continue;
      }
      for (const k of Object.keys(s) as (keyof PortfolioSite)[]) {
        if (seen[k] == null && s[k] != null) (seen as any)[k] = s[k];
      }
    }
    out.notes.push(...part.notes);
  }
  out.sites = out.sites.slice(0, MAX_PORTFOLIO_SITES);
  return out;
}

/**
 * Split OM text into sections an agent call can read, breaking only at page
 * markers so no site row is cut in half.
 */
export function splitOmText(text: string, maxChars = 90000): string[] {
  const pages = text.split(/(?=\n\[Page \d+\] )/);
  const out: string[] = [];
  let cur = "";
  for (const p of pages) {
    if (cur && cur.length + p.length > maxChars) {
      out.push(cur);
      cur = "";
    }
    // A single page over the limit is cut rather than dropped.
    cur += p.length > maxChars ? p.slice(0, maxChars) : p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
