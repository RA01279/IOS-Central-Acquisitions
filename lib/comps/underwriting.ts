// lib/comps/underwriting.ts
//
// What the comps say a deal's underwriting should assume. The Excel model
// stays the driver; this is the evidence an analyst types into it, shown next
// to what the model says:
//
//   * Lease-up: what the space should lease for, per lot acre per month and
//     per building SF per year, with the term and free rent the comps were
//     signed at.
//   * Exit: what the property should sell for after a 36, 48 or 60 month hold,
//     per acre and per building SF, grown at the rate the market's sales have
//     actually moved.
//
// Every figure comes from the same place as the deal's comps panel and flags:
// the comps nearest the deal under COMP_POLICY, weighted by fit. Only when
// fewer than COMP_POLICY.minComps qualify does it fall back to the deal's
// market median, and the source line says which. Pure, so it is testable.

import { COMP_POLICY, haversineMiles, isUsableForDistance, marketRange, scoreComps, suggestRange, unitValue } from "./match";
import { rateStats } from "./market";
import type { CompRecord, CompType, Subject, ValueBasis } from "./match";

const SQFT_PER_ACRE = 43560;
/** Hold periods the exit table is shown for. */
export const DEFAULT_HOLDS = [36, 48, 60];
/** Selling costs (broker, title, closing) taken off the exit price, as a fraction. */
export const SALE_COST_PCT = 0.02;
/** Annual escalation assumed when no comp behind the rent states one: the LOI default. */
export const DEFAULT_ESCALATION = 0.035;
/** The second circle tried when too few comps sit within COMP_POLICY.radiusMiles. */
const WIDE_RADIUS_MILES = 25;
/** Sales history a growth rate is read from. */
const GROWTH_YEARS = 5;
/** Fewer dated sales than this, or a span shorter than two years, and the trend is noise. */
const GROWTH_MIN_SALES = 8;
/**
 * A measured rate beyond this is capped. A comp-set trend mixes real growth
 * with which sites happened to sell -- DFW per-acre sales read +17.9%/yr --
 * and compounding that for five years would set the exit, not test it.
 */
const GROWTH_CAP = 0.05;

export interface UwComp extends CompRecord {
  lease_term_months?: number | null;
  free_rent_months?: number | null;
  escalations_pct?: number | null;
}

export interface Band {
  mid: number | null;
  low: number | null;
  high: number | null;
  count: number;
  /** Where the figure came from, in a sentence. */
  source: string;
  caveats: string[];
}

export interface Growth {
  /** The annual rate applied: the measured rate, capped, or 0 when it couldn't be measured. */
  rate: number;
  /** The rate the sales actually show, before any cap. */
  measured: number | null;
  count: number;
  note: string;
}

export interface Totals { low: number | null; mid: number | null; high: number | null }

export interface ExitRow {
  months: number;
  perAcre: Totals;
  perSf: Totals;
  /** Per-acre value times the deal's lot acres, net of selling costs. */
  byAcre: Totals | null;
  /** Per-SF value times the deal's building SF, net of selling costs. */
  bySf: Totals | null;
  /**
   * Income value, net of selling costs: the comps' market rent, escalated to
   * the exit, over the exit cap. Null without an exit cap or a market rent.
   */
  byIncome: Totals | null;
}

export interface CompUnderwriting {
  lease: {
    /** $ per lot acre per month. */
    perAcreMonthly: Band;
    /** $ per building SF per year. */
    perSfAnnual: Band;
    /** Whole-property monthly rent at the per-acre band. */
    monthlyByAcre: Totals | null;
    /** Whole-property annual rent at the per-SF band. */
    annualBySf: Totals | null;
    termMonths: number | null;
    freeRentMonths: number | null;
    /** Comps that stated a term / free rent, behind the two figures above. */
    termCount: number;
    freeCount: number;
    /** Annual escalation applied to rent to the exit, as a fraction. */
    escalation: number;
    /** Comps that stated an escalation; 0 means DEFAULT_ESCALATION was used. */
    escalationCount: number;
  };
  sale: {
    /** $ per lot acre today. */
    perAcre: Band;
    /** $ per building SF today. */
    perSf: Band;
    growthAcre: Growth;
    growthSf: Growth;
    exits: ExitRow[];
    /** The exit cap the income values use, as a fraction, or null when none is set. */
    exitCap: number | null;
  };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const dateOf = (c: CompRecord) => (c.comp_type === "sale" ? c.closed_on : c.date_commenced) ?? null;
const sameMarket = (c: CompRecord, s: Subject) =>
  !!s.market && (c.market ?? "").trim().toLowerCase() === s.market.trim().toLowerCase();
const sameClass = (c: CompRecord, s: Subject) => !s.assetClass || c.asset_class === s.assetClass;

/** Within the wide circle, measured only between precisely located points. */
const withinWide = (c: CompRecord, s: Subject) =>
  s.lat !== null && s.lng !== null && c.latitude != null && c.longitude != null && isUsableForDistance(c.geocode_precision) &&
  haversineMiles(s.lat, s.lng, Number(c.latitude), Number(c.longitude)) <= WIDE_RADIUS_MILES;

function monthsBefore(today: Date, months: number): string {
  const d = new Date(today.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One rate band in the unit shown: lease land per acre per month, lease
 * building per SF per year, sale land per acre, sale building per SF.
 */
function estimate(comps: UwComp[], subject: Subject, type: CompType, basis: ValueBasis, today: Date): Band & { used: UwComp[] } {
  const scale = basis === "land" ? SQFT_PER_ACRE : type === "lease" ? 12 : 1;
  const what = `${type === "lease" ? "lease" : "sale"} comps`;
  const { scored, range } = marketRange(comps, subject, type, basis, { today });
  if (range.count >= COMP_POLICY.minComps && range.mid !== null) {
    return {
      mid: range.mid * scale,
      low: range.low === null ? null : range.low * scale,
      high: range.high === null ? null : range.high * scale,
      count: range.count,
      source: `${range.count} ${what} within ${COMP_POLICY.radiusMiles} mi from the last ${COMP_POLICY.maxAgeMonths} months, weighted by fit`,
      caveats: range.caveats,
      used: scored.filter((s) => s.inRange && s.unitValue !== null).map((s) => s.comp as UwComp),
    };
  }

  // Too few nearby: the same ranking over a wider circle. Market labels are
  // too inconsistent to lean on first -- a deal filed under "DFW" or "Forney"
  // matches no comp labelled Dallas or Fort Worth -- but distance is distance.
  const wide = scoreComps(comps, subject, type, { basis, today, radiusMiles: WIDE_RADIUS_MILES, distanceFalloffMi: WIDE_RADIUS_MILES + 5 });
  const wideRange = suggestRange(wide, type, basis);
  if (wideRange.count >= COMP_POLICY.minComps && wideRange.mid !== null) {
    return {
      mid: wideRange.mid * scale,
      low: wideRange.low === null ? null : wideRange.low * scale,
      high: wideRange.high === null ? null : wideRange.high * scale,
      count: wideRange.count,
      source: `${wideRange.count} ${what} within ${WIDE_RADIUS_MILES} mi from the last ${COMP_POLICY.maxAgeMonths} months (only ${range.count} within ${COMP_POLICY.radiusMiles} mi)`,
      caveats: wideRange.caveats,
      used: wide.filter((s) => s.inRange && s.unitValue !== null).map((s) => s.comp as UwComp),
    };
  }

  // Still too few: the deal's market over the same window, plain median.
  const since = monthsBefore(today, COMP_POLICY.maxAgeMonths);
  const asOf = today.toISOString().slice(0, 10);
  const pool = comps.filter((c) => {
    const d = dateOf(c);
    return c.comp_type === type && sameMarket(c, subject) && sameClass(c, subject) && !!d && d >= since && d <= asOf && unitValue(c, basis) !== null;
  });
  const stats = rateStats(pool.map((c) => unitValue(c, basis)! * scale));
  const nearby = `${range.count} within ${COMP_POLICY.radiusMiles} mi`;
  if (stats.median === null) {
    return {
      mid: null, low: null, high: null, count: stats.count,
      source: subject.market
        ? `Not enough ${what}: ${nearby}, ${pool.length} in ${subject.market} from the last ${COMP_POLICY.maxAgeMonths} months`
        : `Not enough ${what} (${nearby}) and the deal has no market to fall back to`,
      caveats: [], used: [],
    };
  }
  return {
    mid: stats.median, low: stats.p25, high: stats.p75, count: stats.count,
    source: `${subject.market} market median of ${stats.count} ${what} from the last ${COMP_POLICY.maxAgeMonths} months (only ${nearby})`,
    caveats: stats.trimmed ? [`${stats.trimmed} outlier${stats.trimmed === 1 ? "" : "s"} left out.`] : [],
    used: pool,
  };
}

/**
 * Annual price growth from the market's sales: a least-squares line through
 * log price against time, over the last five years, after the same outlier
 * fences as every other market figure. Held at 0 when there isn't the
 * evidence, and capped when the evidence says something no one would compound.
 */
export function saleGrowth(comps: UwComp[], subject: Subject, basis: ValueBasis, today: Date): Growth {
  const unit = basis === "land" ? "per acre" : "per SF";
  const since = monthsBefore(today, GROWTH_YEARS * 12);
  const asOf = today.toISOString().slice(0, 10);
  const pts: { t: number; v: number }[] = [];
  for (const c of comps) {
    const d = dateOf(c);
    if (c.comp_type !== "sale" || !(sameMarket(c, subject) || withinWide(c, subject)) || !sameClass(c, subject) || !d || d < since || d > asOf) continue;
    const v = unitValue(c, basis);
    if (v && v > 0) pts.push({ t: Date.parse(`${d}T12:00:00Z`) / (365.25 * 864e5), v });
  }
  const where = `${subject.market ? `in ${subject.market} or ` : ""}within ${WIDE_RADIUS_MILES} mi`;
  // Same Tukey fences as rateStats, so a unit error can't tilt the line.
  const sorted = pts.map((p) => p.v).sort((a, b) => a - b);
  let kept = pts;
  if (sorted.length >= 5) {
    const q = (p: number) => { const i = (sorted.length - 1) * p; const lo = Math.floor(i); return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo); };
    const [q1, q3] = [q(0.25), q(0.75)];
    kept = pts.filter((p) => p.v >= q1 - 1.5 * (q3 - q1) && p.v <= q3 + 1.5 * (q3 - q1));
  }
  const span = kept.length ? Math.max(...kept.map((p) => p.t)) - Math.min(...kept.map((p) => p.t)) : 0;
  if (kept.length < GROWTH_MIN_SALES || span < 2) {
    return { rate: 0, measured: null, count: kept.length, note: `held flat: only ${kept.length} dated sales ${unit} ${where} in the last ${GROWTH_YEARS} years, too few to read a trend` };
  }
  const n = kept.length;
  const mt = kept.reduce((s, p) => s + p.t, 0) / n;
  const my = kept.reduce((s, p) => s + Math.log(p.v), 0) / n;
  const slope = kept.reduce((s, p) => s + (p.t - mt) * (Math.log(p.v) - my), 0) / kept.reduce((s, p) => s + (p.t - mt) ** 2, 0);
  const measured = Math.exp(slope) - 1;
  const rate = Math.max(-GROWTH_CAP, Math.min(GROWTH_CAP, measured));
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  return {
    rate, measured, count: n,
    note: rate === measured
      ? `${pct(measured)}/yr, the trend in ${n} sales ${unit} ${where} over ${span.toFixed(1)} years`
      : `${pct(rate)}/yr: ${n} sales ${unit} ${where} show ${pct(measured)}/yr, capped`,
  };
}

const times = (b: Totals, k: number | null): Totals | null =>
  k && k > 0 && b.mid !== null ? { low: b.low === null ? null : b.low * k, mid: b.mid * k, high: b.high === null ? null : b.high * k } : null;
const band = (b: Band): Totals => ({ low: b.low, mid: b.mid, high: b.high });

export function compUnderwriting(
  comps: UwComp[],
  subject: Subject,
  opts: { today?: Date; holds?: number[]; /** Fraction, e.g. 0.065. */ exitCap?: number | null; ios?: boolean } = {}
): CompUnderwriting {
  const today = opts.today ?? new Date();
  const acres = subject.lotSf ? subject.lotSf / SQFT_PER_ACRE : null;
  const sf = subject.buildingSf;

  const leaseAcre = estimate(comps, subject, "lease", "land", today);
  const leaseSf = estimate(comps, subject, "lease", "building", today);
  // Term and free rent from the comps behind the rents, each counted once.
  const leaseUsed = [...new Map([...leaseAcre.used, ...leaseSf.used].map((c) => [c.id, c])).values()];
  const terms = leaseUsed.map((c) => num(c.lease_term_months)).filter((v): v is number => v !== null && v > 0);
  const frees = leaseUsed.filter((c) => num(c.lease_term_months) && num(c.free_rent_months) !== null).map((c) => num(c.free_rent_months)!);

  // Stored as a fraction, but a few comps carry a typed percent (4 for 4%).
  const escs = leaseUsed.map((c) => num(c.escalations_pct)).filter((v): v is number => v !== null && v >= 0).map((v) => (v > 0.5 ? v / 100 : v));
  const escalation = median(escs) ?? DEFAULT_ESCALATION;

  const saleAcre = estimate(comps, subject, "sale", "land", today);
  const saleSf = estimate(comps, subject, "sale", "building", today);
  const growthAcre = saleGrowth(comps, subject, "land", today);
  const growthSf = saleGrowth(comps, subject, "building", today);

  const grow = (b: Band, g: number, months: number): Totals => {
    const f = (1 + g) ** (months / 12);
    return { low: b.low === null ? null : b.low * f, mid: b.mid === null ? null : b.mid * f, high: b.high === null ? null : b.high * f };
  };
  const exits = (opts.holds ?? DEFAULT_HOLDS).map((months) => {
    const perAcre = grow(saleAcre, growthAcre.rate, months);
    const perSf = grow(saleSf, growthSf.rate, months);
    const net = 1 - SALE_COST_PCT;
    // Rent is taken as NOI: IOS and industrial leases here are overwhelmingly
    // net. IOS income is the per-acre rent over the lot, industrial the
    // per-SF rent over the building -- the unit each trades in.
    const rent = (opts.ios ?? subject.assetClass !== "industrial") ? times(band(leaseAcre), acres && acres * 12) : times(band(leaseSf), sf);
    const cap = opts.exitCap && opts.exitCap > 0 ? opts.exitCap : null;
    const byIncome = rent && cap ? times(rent, ((1 + escalation) ** (months / 12) * net) / cap) : null;
    return { months, perAcre, perSf, byAcre: times(perAcre, acres && acres * net), bySf: times(perSf, sf && sf * net), byIncome };
  });

  const strip = ({ used: _u, ...b }: Band & { used: UwComp[] }): Band => b;
  return {
    lease: {
      perAcreMonthly: strip(leaseAcre),
      perSfAnnual: strip(leaseSf),
      monthlyByAcre: times(band(leaseAcre), acres),
      annualBySf: times(band(leaseSf), sf),
      termMonths: median(terms),
      freeRentMonths: median(frees),
      termCount: terms.length,
      freeCount: frees.length,
      escalation,
      escalationCount: escs.length,
    },
    sale: { perAcre: strip(saleAcre), perSf: strip(saleSf), growthAcre, growthSf, exits, exitCap: opts.exitCap && opts.exitCap > 0 ? opts.exitCap : null },
  };
}
