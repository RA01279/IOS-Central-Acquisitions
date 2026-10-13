// lib/comps/market.ts
//
// What the comps say about a whole market, as opposed to one subject: the
// going rate now, a year ago, and the path between. Pure functions with no
// I/O, so the Market page, the deal screens and the tests share one answer.
//
// The matcher (match.ts) answers "what is this property worth, given the
// comps nearest it". This answers "what is Dallas IOS renting for", which is
// a different question with different rules:
//
//   * Each comp counts once. No distance or size weighting -- there is no
//     subject to be near to.
//   * The statistic is a median, and only after trimming. 440 comps across
//     seven markets is thin, and one unit error (an annual rent read as
//     monthly) moves a mean of twelve comps by 80%. Values outside Tukey's
//     fences (1.5 x IQR) are dropped and counted, never hidden.
//   * Rates are in the unit each asset class trades in: IOS per acre (rents
//     per acre per month, sales per acre of land), industrial per building SF
//     (rents per SF per year, sales per SF).
//   * Lease rates are EFFECTIVE where the comp says what was given away: free
//     rent spread over the term, and for industrial, TI amortised straight-line.
//     A comp that doesn't state concessions is taken at face; how many did is
//     reported, so a reader knows how much "effective" there is in it.

import { rateViews } from "./rates";
import type { CompRecord, CompType } from "./match";

export type MarketClass = "ios" | "industrial";

const SQFT_PER_ACRE = 43560;
/** Fewer comps than this in a period and its median is not shown. */
export const MARKET_MIN_COMPS = 3;
/** Fences only mean something with a few values to set them. */
const TRIM_MIN_COMPS = 5;

export interface MarketComp extends CompRecord {
  status?: string | null;
  lease_term_months?: number | null;
  free_rent_months?: number | null;
  ti_psf?: number | null;
}

export const RATE_UNITS: Record<CompType, Record<MarketClass, string>> = {
  lease: { ios: "$/AC/mo", industrial: "$/SF/yr" },
  sale: { ios: "$/AC land", industrial: "$/SF" },
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export const compDate = (c: CompRecord): string | null =>
  (c.comp_type === "sale" ? c.closed_on : c.date_commenced) ?? null;

export interface CompRate {
  /** The face rate in the class's unit. */
  face: number;
  /** After stated concessions; equal to face when none are stated. */
  effective: number;
  /** True when free rent or TI was stated and applied. */
  concessions: boolean;
}

/** A comp's rate in its class's market unit, or null when it can't be derived. */
export function compRate(c: MarketComp, cls: MarketClass, opts: { lotAcres?: boolean } = {}): CompRate | null {
  if (c.comp_type === "sale") {
    const price = num(c.sale_price);
    if (!price || price <= 0) return null;
    const denom = cls === "ios" ? (num(c.lot_sf) ?? 0) / SQFT_PER_ACRE : num(c.building_sf);
    if (!denom || denom <= 0) return null;
    const v = price / denom;
    return { face: v, effective: v, concessions: false };
  }

  const views = rateViews(c);
  // IOS rents are quoted per usable yard acre; a deal is measured over its lot,
  // so a comparison with one asks for per lot acre instead.
  const face = cls === "ios"
    ? opts.lotAcres ? (views.perSfLandMonthly === null ? null : views.perSfLandMonthly * SQFT_PER_ACRE) : views.perAcreMonthly
    : views.perSfBldgAnnual;
  if (face === null || face <= 0) return null;

  const term = num(c.lease_term_months);
  const free = num(c.free_rent_months) ?? 0;
  const ti = cls === "industrial" ? num(c.ti_psf) ?? 0 : 0;
  if (!term || term <= 0 || (free <= 0 && ti <= 0)) return { face, effective: face, concessions: false };

  // Free months spread across the whole term; TI ($/SF, one-off) spread as an
  // annual $/SF over the term. No discounting: the comps don't state a rate to
  // discount at, and straight-line is how the market quotes "net effective".
  let effective = face * Math.max(0, term - Math.min(free, term)) / term;
  if (ti > 0) effective -= (ti * 12) / term;
  return { face, effective: Math.max(0, effective), concessions: true };
}

/** The asset class a comp is reported under, or null when it has none. */
export function marketClassOf(c: CompRecord): MarketClass | null {
  return c.asset_class === "ios" || c.asset_class === "industrial" ? c.asset_class : null;
}

// ---- statistics ------------------------------------------------------------

/** Linear-interpolated quantile of a sorted list. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface RateStats {
  /** Comps behind the figures, after trimming. */
  count: number;
  /** Comps dropped as outside the fences. */
  trimmed: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

/**
 * Median and interquartile range after dropping values outside Tukey's fences.
 * The median is null below MARKET_MIN_COMPS: two comps are an anecdote.
 */
export function rateStats(values: number[]): RateStats {
  let xs = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  let trimmed = 0;
  if (xs.length >= TRIM_MIN_COMPS) {
    const q1 = quantile(xs, 0.25);
    const q3 = quantile(xs, 0.75);
    const fence = 1.5 * (q3 - q1);
    const kept = xs.filter((v) => v >= q1 - fence && v <= q3 + fence);
    trimmed = xs.length - kept.length;
    xs = kept;
  }
  if (xs.length < MARKET_MIN_COMPS) return { count: xs.length, trimmed, median: null, p25: null, p75: null };
  return { count: xs.length, trimmed, median: quantile(xs, 0.5), p25: quantile(xs, 0.25), p75: quantile(xs, 0.75) };
}

// ---- periods ---------------------------------------------------------------

/** ISO date `months` before `today`. */
export function monthsBefore(today: string, months: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** "2025 H2" for a date. Half-years: quarters are too thin at this volume. */
export function halfOf(date: string): string {
  return `${date.slice(0, 4)} H${Number(date.slice(5, 7)) <= 6 ? 1 : 2}`;
}

/** The last `n` half-years up to and including today's, oldest first. */
export function recentHalves(today: string, n: number): string[] {
  const out: string[] = [];
  let y = Number(today.slice(0, 4));
  let h = Number(today.slice(5, 7)) <= 6 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    out.unshift(`${y} H${h}`);
    if (h === 2) h = 1;
    else { h = 2; y--; }
  }
  return out;
}

// ---- roll-up ---------------------------------------------------------------

export interface MarketRow {
  /** Market or submarket label as stored. */
  label: string;
  /** Trailing 12 months. */
  current: RateStats;
  /** The 12 months before that. */
  prior: RateStats;
  /** Current median vs prior, as a fraction; null unless both have a median. */
  change: number | null;
  /** Median per half-year, oldest first, aligned with MarketView.halves. */
  trend: (number | null)[];
  /** Comps in the trailing 12 months whose concessions were applied. */
  withConcessions: number;
  /** Every dated, rated comp, any age. */
  total: number;
  /** Most recent comp date. */
  latest: string | null;
}

export interface MarketView {
  compType: CompType;
  assetClass: MarketClass;
  unit: string;
  halves: string[];
  rows: MarketRow[];
  /** All markets together, for the headline. */
  overall: MarketRow;
  /** Comps of this type with no asset class, and so in no row. */
  unclassified: number;
}

export interface MarketOptions {
  /** ISO date; defaults to the real today. Injectable for tests. */
  today?: string;
  /** Use the face rate instead of effective. */
  face?: boolean;
  /** Group by submarket within this market instead of by market. */
  market?: string | null;
  /** IOS rents per lot acre rather than per yard acre (see compRate). */
  lotAcres?: boolean;
  /** Half-years in the trend. */
  halves?: number;
}

interface Point { date: string; rate: number; concessions: boolean; group: string }

function rowOf(label: string, pts: Point[], today: string, halves: string[]): MarketRow {
  const yearAgo = monthsBefore(today, 12);
  const twoYearsAgo = monthsBefore(today, 24);
  const cur = pts.filter((p) => p.date > yearAgo && p.date <= today);
  const prev = pts.filter((p) => p.date > twoYearsAgo && p.date <= yearAgo);
  const current = rateStats(cur.map((p) => p.rate));
  const prior = rateStats(prev.map((p) => p.rate));
  const byHalf = new Map<string, number[]>();
  for (const p of pts) {
    const h = halfOf(p.date);
    byHalf.set(h, [...(byHalf.get(h) ?? []), p.rate]);
  }
  return {
    label,
    current,
    prior,
    change: current.median !== null && prior.median ? current.median / prior.median - 1 : null,
    trend: halves.map((h) => rateStats(byHalf.get(h) ?? []).median),
    withConcessions: cur.filter((p) => p.concessions).length,
    total: pts.length,
    latest: pts.reduce<string | null>((m, p) => (m === null || p.date > m ? p.date : m), null),
  };
}

/**
 * Confirmed comps of one type and class, rolled up by market (or by submarket
 * within one market). Rows are ordered by how much recent evidence they have.
 */
export function marketView(comps: MarketComp[], compType: CompType, assetClass: MarketClass, opts: MarketOptions = {}): MarketView {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const halves = recentHalves(today, opts.halves ?? 6);
  const ofType = comps.filter((c) => c.comp_type === compType && (c.status ?? "confirmed") === "confirmed");
  const inMarket = opts.market
    ? ofType.filter((c) => (c.market ?? "").toLowerCase() === opts.market!.toLowerCase())
    : ofType;

  const points: Point[] = [];
  for (const c of inMarket) {
    if (marketClassOf(c) !== assetClass) continue;
    const date = compDate(c);
    const r = compRate(c, assetClass, { lotAcres: opts.lotAcres });
    if (!date || !r || date > today) continue;
    const group = (opts.market ? c.submarket : c.market)?.trim() || (opts.market ? "No submarket" : "No market");
    points.push({ date, rate: opts.face ? r.face : r.effective, concessions: r.concessions, group });
  }

  const groups = new Map<string, Point[]>();
  for (const p of points) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  const rows = [...groups.entries()]
    .map(([label, pts]) => rowOf(label, pts, today, halves))
    .sort((a, b) => b.current.count + b.current.trimmed - (a.current.count + a.current.trimmed) || b.total - a.total || a.label.localeCompare(b.label));

  return {
    compType,
    assetClass,
    unit: RATE_UNITS[compType][assetClass],
    halves,
    rows,
    overall: rowOf(opts.market ?? "All markets", points, today, halves),
    unclassified: inMarket.filter((c) => marketClassOf(c) === null).length,
  };
}

// ---- for a deal ------------------------------------------------------------

export interface MarketFigure {
  /** Trailing-12-month median in the deal's units, or null when too thin. */
  value: number | null;
  count: number;
  /** Year-on-year change of the median, as a fraction. */
  change: number | null;
  /** e.g. "Dallas IOS lease comps, last 12 months". */
  label: string;
}

/**
 * The market-wide figure a deal is set against when there aren't enough comps
 * near it, and the trend it sits in when there are. Face rates (a deal's rent
 * is face), and in the units a deal is measured in: IOS rents per lot acre per
 * month, industrial rents per building SF per MONTH, sales per lot acre or per
 * building SF.
 */
export function marketFigureFor(
  comps: MarketComp[],
  compType: CompType,
  assetClass: MarketClass,
  market: string | null | undefined,
  today?: string
): MarketFigure {
  const label = `${market ?? "All"} ${assetClass === "ios" ? "IOS" : "industrial"} ${compType} comps, last 12 months`;
  if (!market) return { value: null, count: 0, change: null, label };
  const v = marketView(comps, compType, assetClass, { today, market, face: true, lotAcres: true }).overall;
  const perMonth = compType === "lease" && assetClass === "industrial" ? 1 / 12 : 1;
  return {
    value: v.current.median === null ? null : v.current.median * perMonth,
    count: v.current.count,
    change: v.change,
    label,
  };
}
