// lib/agents/deal-import.ts
//
// The "deal-import" agent: read an OM and/or broker email and return the New
// Deal form's fields as JSON. Client-safe (types + parser) so the form can
// validate the result itself. The agent only DRAFTS -- a person reviews the
// filled form and clicks Create; nothing is written from the agent output.

export const DEAL_IMPORT_FIELDS = [
  "address",
  "city",
  "state",
  "market",
  "acres",
  "buildingSf",
  "askingPrice",
  "occupancy",
  "waltYears",
  "tenancy",
  "assetClass",
  "acquisitionType",
  "marketingStatus",
  "sellerBroker",
  "currentOwner",
] as const;
export type DealImportField = (typeof DEAL_IMPORT_FIELDS)[number];

export interface DealImport {
  fields: {
    address: string | null;
    city: string | null;
    state: string | null;
    market: string | null;
    acres: number | null;
    buildingSf: number | null;
    askingPrice: number | null;
    occupancy: "vacant" | "occupied" | null;
    waltYears: number | null;
    tenancy: "single_tenant" | "multi_tenant" | null;
    assetClass: "ios" | "industrial" | null;
    acquisitionType: "standard" | "slb" | null;
    marketingStatus: "marketed" | "off_market" | null;
    sellerBroker: string | null;
    currentOwner: string | null;
  };
  /** Field -> short verbatim quote from the source supporting it. */
  evidence: Partial<Record<DealImportField, string>>;
  /** Things a reviewer should double-check (conflicting figures, multiple sites...). */
  notes: string[];
}

export const DEAL_IMPORT_INSTRUCTIONS = `Read the supplied offering memorandum (OM) and/or broker email and extract ONE property for a new acquisition deal. The report field MUST be a serialized JSON object, nothing else, with exactly this shape:
{"fields":{"address":string|null,"city":string|null,"state":string|null,"market":string|null,"acres":number|null,"buildingSf":number|null,"askingPrice":number|null,"occupancy":"vacant"|"occupied"|null,"waltYears":number|null,"tenancy":"single_tenant"|"multi_tenant"|null,"assetClass":"ios"|"industrial"|null,"acquisitionType":"standard"|"slb"|null,"marketingStatus":"marketed"|"off_market"|null,"sellerBroker":string|null,"currentOwner":string|null},"evidence":{"<fieldName>":"short verbatim quote"},"notes":[string]}
Rules:
- address = street address only (no city/state/zip). state = 2-letter code. market = the metro (e.g. "Houston", "DFW", "Austin", "San Antonio"), not the submarket.
- acres = total land area in acres (convert from SF: divide by 43,560). buildingSf = total building square feet. Plain numbers, no units or commas.
- askingPrice = the seller's stated asking/list price in dollars as a plain number. If the OM says "unpriced", "call for offers" or gives no price, use null. Never derive a price from cap rates or per-SF figures.
- occupancy: "occupied" if there is a tenant or in-place lease, "vacant" if delivered vacant; waltYears = remaining lease term in years if stated.
- assetClass: "ios" when the site is primarily an industrial outdoor storage yard (truck/trailer/equipment yard, large paved or stabilized yard with a small building), else "industrial" for warehouse/distribution/flex.
- acquisitionType: "slb" only for an explicit sale-leaseback; otherwise "standard". marketingStatus: "marketed" when it is a broker-listed offering (an OM or listing flyer), "off_market" only when the source says so.
- sellerBroker = the listing broker's name and firm, e.g. "Jane Smith, CBRE". currentOwner = the seller/owner entity if named.
- Every non-null field needs a short verbatim quote in evidence. Unknown stays null; never guess.
- If the source covers several properties, extract the main/first one and say so in notes. Put conflicting figures (e.g. two different acreages) in notes.`;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : null);

/** Strict parse of the agent's report; null when it isn't the contract. */
export function parseDealImport(report: string): DealImport | null {
  let raw: any;
  try {
    raw = JSON.parse(report.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || !raw.fields || typeof raw.fields !== "object") return null;
  const f = raw.fields;
  const out: DealImport = {
    fields: {
      address: str(f.address),
      city: str(f.city, 80),
      state: str(f.state, 2)?.toUpperCase() ?? null,
      market: str(f.market, 80),
      acres: num(f.acres),
      buildingSf: num(f.buildingSf),
      askingPrice: num(f.askingPrice),
      occupancy: pick(f.occupancy, ["vacant", "occupied"] as const),
      waltYears: num(f.waltYears),
      tenancy: pick(f.tenancy, ["single_tenant", "multi_tenant"] as const),
      assetClass: pick(f.assetClass, ["ios", "industrial"] as const),
      acquisitionType: pick(f.acquisitionType, ["standard", "slb"] as const),
      marketingStatus: pick(f.marketingStatus, ["marketed", "off_market"] as const),
      sellerBroker: str(f.sellerBroker),
      currentOwner: str(f.currentOwner),
    },
    evidence: {},
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n: unknown) => typeof n === "string").slice(0, 10).map((n: string) => n.slice(0, 400)) : [],
  };
  if (raw.evidence && typeof raw.evidence === "object") {
    for (const k of DEAL_IMPORT_FIELDS) {
      const q = str(raw.evidence[k], 300);
      if (q) out.evidence[k] = q;
    }
  }
  // An import with no address is not a deal draft.
  return out.fields.address ? out : null;
}
