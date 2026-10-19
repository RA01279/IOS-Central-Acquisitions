// lib/comps/review.ts
//
// What holds a comp back for a person before it can move a market figure.
// Pure functions with no I/O, so intake, the backfill and the tests share
// one implementation.
//
// Intake already has a human look at every parsed row, so most comps still
// save straight to 'confirmed'. A comp is held as a 'draft' only for a reason
// a reviewer scanning a 282-row file is likely to miss:
//
//   possible_duplicate  the same deal is already in Hopper. The canonical TX
//                       IOS workbook carries ten leases twice (same tenant and
//                       rent, dated the 1st and the 24th of one month), and an
//                       exact-match unique index can't see that.
//   rate_outlier        the rate is far outside what the same market shows,
//                       which is usually a unit error (annual read as monthly,
//                       a total read as per acre) rather than a real deal.

import { haversineMiles, unitValue, type CompRecord } from "./match";

export type ReviewFlag = "possible_duplicate" | "rate_outlier" | "future_date";

export const REVIEW_FLAG_LABELS: Record<ReviewFlag, string> = {
  possible_duplicate: "Possible duplicate",
  rate_outlier: "Rate far outside its market",
  future_date: "Dated in the future (proposed, not executed?)",
};

const SQFT_PER_ACRE = 43560;
/** Same deal if dated within this many days of an existing one. */
const DUPLICATE_WINDOW_DAYS = 60;
/** Two pins this close are one site, whatever the address strings say. */
const SAME_SITE_MILES = 0.03; // ~160 ft
/** An outlier needs a market to stand out from. */
const OUTLIER_MIN_PEERS = 10;
/** Outside median / 2.5 .. median * 2.5 is held. */
const OUTLIER_FACTOR = 2.5;

// ---- names -----------------------------------------------------------------

/**
 * Tidy a free-text name without changing what it says: typographic hyphens
 * and quotes to plain ones, whitespace collapsed. "Mid‑Cities" (non-breaking
 * hyphen) and "Mid-Cities" were two submarkets.
 */
export function cleanName(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v)
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

/** Spelling-insensitive identity: "CanTex Capital" = "Cantex Capital", "Tri-county" = "Tri County". */
export function nameKey(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(llc|inc|corp|co|lp|ltd)$/, "");
}

/**
 * The spelling already in use for a name, so a new comp joins the existing
 * "Tri County" rather than starting "Tri-county". The most common spelling
 * wins; a name nobody has used yet is kept as typed (tidied).
 */
export function canonicalSpellings(existing: (string | null | undefined)[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const raw of existing) {
    const v = cleanName(raw);
    if (!v) continue;
    const k = nameKey(v);
    if (!k) continue;
    const m = counts.get(k) ?? new Map<string, number>();
    m.set(v, (m.get(v) ?? 0) + 1);
    counts.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of counts) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  return out;
}

export function canonicalName(v: string | null | undefined, spellings: Map<string, string>): string | null {
  const s = cleanName(v);
  if (!s) return null;
  return spellings.get(nameKey(s)) ?? s;
}

// ---- duplicates ------------------------------------------------------------

/** Street address in comparable form: first line only, common suffixes abbreviated. */
export function normalizeAddress(a: string | null | undefined): string {
  return (a ?? "")
    .toLowerCase()
    .split(",")[0]
    .replace(/[.#]/g, "")
    .replace(/\broad\b/g, "rd").replace(/\bstreet\b/g, "st").replace(/\bdrive\b/g, "dr")
    .replace(/\bhighway\b/g, "hwy").replace(/\bboulevard\b/g, "blvd").replace(/\bavenue\b/g, "ave")
    .replace(/\blane\b/g, "ln").replace(/\bparkway\b/g, "pkwy").replace(/\bfreeway\b/g, "fwy")
    .replace(/\bnorth\b/g, "n").replace(/\bsouth\b/g, "s").replace(/\beast\b/g, "e").replace(/\bwest\b/g, "w")
    .replace(/\s+/g, " ")
    .trim();
}

export type DupCandidate = Pick<CompRecord, "comp_type" | "address" | "latitude" | "longitude" | "rent" | "sale_price" | "date_commenced" | "closed_on" | "tenant_name" | "buyer" | "suite" | "project_name"> & { id?: string };

const dateOf = (c: DupCandidate) => (c.comp_type === "sale" ? c.closed_on : c.date_commenced) ?? null;
const days = (a: string, b: string) => Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86400000;
const sameText = (a?: string | null, b?: string | null) => !!a && !!b && nameKey(a) === nameKey(b);
const close = (a?: number | string | null, b?: number | string | null) =>
  a != null && b != null && Number(a) > 0 && Math.abs(Number(a) - Number(b)) / Number(a) <= 0.01;

/**
 * The existing comp this one probably repeats, or null.
 *
 * Same type, same site (address or pin), same suite and building, dated within
 * 60 days -- and then the same money or the same party. Requiring both a
 * place-and-time match AND a deal match is what keeps a business park that
 * sold two buildings on one day for the same price (Pine Crossing C and D:
 * different project names) from being called a duplicate.
 */
export function findDuplicate(c: DupCandidate, existing: DupCandidate[]): DupCandidate | null {
  const d = dateOf(c);
  if (!d) return null;
  const addr = normalizeAddress(c.address);
  for (const e of existing) {
    if (e.comp_type !== c.comp_type || (c.id && e.id === c.id)) continue;
    const sameSite =
      normalizeAddress(e.address) === addr ||
      (c.latitude != null && c.longitude != null && e.latitude != null && e.longitude != null &&
        haversineMiles(Number(c.latitude), Number(c.longitude), Number(e.latitude), Number(e.longitude)) <= SAME_SITE_MILES);
    if (!sameSite) continue;
    if ((cleanName(c.suite) ?? "") !== (cleanName(e.suite) ?? "")) continue;
    if ((cleanName(c.project_name) ?? "").toLowerCase() !== (cleanName(e.project_name) ?? "").toLowerCase()) continue;
    const ed = dateOf(e);
    if (!ed || days(d, ed) > DUPLICATE_WINDOW_DAYS) continue;
    const sameDeal =
      c.comp_type === "sale"
        ? close(c.sale_price, e.sale_price) || sameText(c.buyer, e.buyer)
        : close(c.rent, e.rent) || sameText(c.tenant_name, e.tenant_name);
    if (sameDeal) return e;
  }
  return null;
}

// ---- outliers --------------------------------------------------------------

/**
 * A rate in the unit its asset class trades on: IOS per acre of land, else per
 * building SF. Leases monthly, sales total. Null when it can't be derived.
 */
export function marketUnitRate(c: CompRecord): number | null {
  const ios = c.asset_class !== "industrial";
  const v = unitValue(c, ios ? "land" : "building");
  return v === null ? null : ios ? v * SQFT_PER_ACRE : v;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Whether a comp's rate is far enough from its market's median to be a
 * probable unit error. Peers are the same type, class and market; with fewer
 * than ten there is no market to stand out from and nothing is flagged.
 */
export function isRateOutlier(c: CompRecord, peers: CompRecord[]): boolean {
  const v = marketUnitRate(c);
  if (v === null || !c.market) return false;
  const cls = c.asset_class ?? "ios";
  const rates = peers
    .filter((p) => p.id !== c.id && p.comp_type === c.comp_type && (p.asset_class ?? "ios") === cls &&
      p.market?.toLowerCase() === c.market!.toLowerCase())
    .map(marketUnitRate)
    .filter((x): x is number => x !== null && x > 0);
  if (rates.length < OUTLIER_MIN_PEERS) return false;
  const m = median(rates);
  return v > m * OUTLIER_FACTOR || v < m / OUTLIER_FACTOR;
}
