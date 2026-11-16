// lib/agents/deal-import.ts
//
// The "deal-import" agent: read an OM and/or broker email and return the New
// Deal form's fields as JSON. When an email covers several SEPARATE
// opportunities (a broker's "three sites you might like"), the first is the
// main draft and the rest come back in `others`, each its own draft, for the
// New Deal screen's multi-property cards (components/MultiDealImport.tsx). A
// package sold together is still one draft -- that's the Portfolio import. Client-safe (types + parser) so the form can
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
  "callForOffersOn",
  "deadlineSourceDate",
  "deadlineSourceQuote",
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
    /** Each listing broker on the OM / email, with the details printed next to them. */
    sellerBrokers?: { name: string; firm: string | null; email: string | null; phone: string | null }[];
    currentOwner: string | null;
    /** What the broker said about this property beyond the fields: pricing guidance, owner motivation, lease terms, zoning, buildings. */
    brokerNotes?: string | null;
    callForOffersOn?: string | null;
    deadlineSourceDate?: string | null;
    deadlineSourceQuote?: string | null;
  };
  /** Field -> short verbatim quote from the source supporting it. */
  evidence: Partial<Record<DealImportField, string>>;
  /** Things a reviewer should double-check (conflicting figures, multiple sites...). */
  notes: string[];
  /** Other, separately offered properties in the same email or OM -- each its own draft. */
  others?: DealImport[];
}

/** Most separate properties read from one source. */
export const MAX_IMPORT_PROPERTIES = 12;

export const DEAL_IMPORT_INSTRUCTIONS = `Read the supplied offering memorandum (OM) and/or broker email and extract ONE property for a new acquisition deal. The report field MUST be a serialized JSON object, nothing else, with exactly this shape:
{"fields":{"address":string|null,"city":string|null,"state":string|null,"market":string|null,"acres":number|null,"buildingSf":number|null,"askingPrice":number|null,"occupancy":"vacant"|"occupied"|null,"waltYears":number|null,"tenancy":"single_tenant"|"multi_tenant"|null,"assetClass":"ios"|"industrial"|null,"acquisitionType":"standard"|"slb"|null,"marketingStatus":"marketed"|"off_market"|null,"sellerBroker":string|null,"sellerBrokers":[{"name":string,"firm":string|null,"email":string|null,"phone":string|null}],"currentOwner":string|null,"brokerNotes":string|null},"evidence":{"<fieldName>":"short verbatim quote"},"notes":[string],"otherProperties":[{"fields":{...same keys...},"evidence":{...},"notes":[string]}]}
Rules:
- Include callForOffersOn, deadlineSourceDate, deadlineSourceQuote in fields. callForOffersOn must be an explicit YYYY-MM-DD offer deadline supported by a verbatim source quote. deadlineSourceDate is the original message/document date, not today's date. Do not infer a year or convert ambiguous relative dates; return null and explain ambiguity in notes. Proposed leases are not in-place occupancy.
- address = street address only (no city/state/zip). state = 2-letter code. market = the metro (e.g. "Houston", "Dallas", "Fort Worth", "Austin", "San Antonio", "Atlanta", "Savannah"; Dallas-Fort Worth is two markets), not the submarket. When the source names only a city or suburb, give the metro it belongs to (Villa Rica or Alpharetta GA -> Atlanta; Pooler GA -> Savannah; Katy TX -> Houston) -- that is geography, not a guess; leave null only when the city is unknown.
- acres = total land area in acres (convert from SF: divide by 43,560). buildingSf = total building square feet. Plain numbers, no units or commas.
- askingPrice = the seller's stated asking/list price in dollars as a plain number. If the OM says "unpriced", "call for offers" or gives no price, use null. Never derive a price from cap rates or per-SF figures.
- occupancy: "occupied" only if current physical occupation is explicit (a commenced lease or owner occupation), "vacant" if delivered vacant. A named proposed tenant or signed future lease alone does not establish current occupation; otherwise null. waltYears = remaining lease term in years if stated.
- assetClass: "ios" when the site is primarily an industrial outdoor storage yard (truck/trailer/equipment yard, large paved or stabilized yard with a small building), else "industrial" for warehouse/distribution/flex.
- acquisitionType: "slb" only for an explicit sale-leaseback; otherwise "standard". marketingStatus: "marketed" when it is a broker-listed offering (an OM or listing flyer), "off_market" only when the source says so.
- sellerBrokers = EVERY listing broker named in the source (OMs usually list a team), one entry each: their name, their firm, and the email and phone printed with their name (null when not shown; never invent one). sellerBroker = the same people on one line, e.g. "Jane Smith & Tom Ruiz, CBRE". currentOwner = the seller/owner entity if named.
- Every non-null field needs a short verbatim quote in evidence. Unknown stays null; never guess.
- brokerNotes = a short plain summary (under 600 characters) of what the source says about THIS property beyond the fields: pricing guidance and how firm it is, owner motivation, current lease / rent / renewal terms, zoning, county, buildings, fencing, usable vs gross land. Facts from the source only.
- Pricing guidance ("guidance is $10M", "think owner will accept mid $5M's") counts as askingPrice when it is a single figure; for a range or "mid $5M's" use null and put the words in brokerNotes. Say "guidance" in notes when askingPrice came from guidance.
- SEVERAL PROPERTIES: if the source describes several SEPARATE opportunities -- each with its own address and its own pricing, owner or discussion (for example a broker email listing three different sites) -- put the first in fields/evidence/notes and EACH other one in otherProperties, in the order they appear, each with its own fields, evidence (verbatim quotes about that property) and notes, at most 11 others. Brokers named once for the whole email apply to every property (repeat sellerBroker / sellerBrokers on each). If the properties are offered TOGETHER as one package or portfolio for one price, do NOT use otherProperties: extract the main one and say in notes that it is a portfolio (Hopper's Portfolio import handles packages).
- Put conflicting figures (e.g. two different acreages) in notes.
- notes are for a reviewer: only property-specific things to check (a figure derived or added up, guidance vs a firm price, an ambiguous attribution). Do not list generic gaps that apply to every email (no broker named, no message date, no evidence labels, no listing status); at most 5 notes per property.`;

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
  const main = parseOne(raw);
  if (!main) return null;
  const others = (Array.isArray(raw.otherProperties) ? raw.otherProperties : [])
    .slice(0, MAX_IMPORT_PROPERTIES - 1)
    .map(parseOne)
    .filter((d: DealImport | null): d is DealImport => !!d)
    // The same address twice is one property.
    .filter((d: DealImport, i: number, all: DealImport[]) => d.fields.address!.toLowerCase() !== main.fields.address!.toLowerCase() && all.findIndex((x) => x.fields.address!.toLowerCase() === d.fields.address!.toLowerCase()) === i);
  if (others.length) main.others = others;
  return main;
}

/** One property's draft; null when it isn't the contract or has no address. */
function parseOne(raw: any): DealImport | null {
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
      sellerBrokers: Array.isArray(f.sellerBrokers)
        ? f.sellerBrokers
            .filter((b: any) => b && str(b.name))
            .slice(0, 8)
            .map((b: any) => ({ name: str(b.name, 120)!, firm: str(b.firm, 120), email: str(b.email, 120)?.toLowerCase() ?? null, phone: str(b.phone, 40) }))
        : [],
      currentOwner: str(f.currentOwner),
      brokerNotes: str(f.brokerNotes, 1500),
      callForOffersOn: null,
      deadlineSourceDate: null,
      deadlineSourceQuote: str(f.deadlineSourceQuote,500),
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
  const date=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+"T12:00:00Z").toISOString().slice(0,10)===v;
  if(date(f.callForOffersOn)&&date(f.deadlineSourceDate)&&out.fields.deadlineSourceQuote) {
    out.fields.callForOffersOn=f.callForOffersOn;out.fields.deadlineSourceDate=f.deadlineSourceDate;
  } else if(f.callForOffersOn)out.notes.push("Offer deadline needs review: retain explicit date/year, original source date and verbatim supporting quote. No deadline applied.");
  // An import with no address is not a deal draft.
  return out.fields.address ? out : null;
}
