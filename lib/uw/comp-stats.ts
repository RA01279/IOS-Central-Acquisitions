// lib/uw/comp-stats.ts
//
// Comp-driven assumptions: market rent per acre, price per acre and exit cap
// as downside / base / upside, each with n, range and the comp ids behind it.
// Pure: works on the output of comp-adapter.
//
// Selection: one market, status confirmed, the last 36 months (24 optional).
// Suspect duplicates and comps that can't be converted are left out of every
// statistic. Stats are computed within acreage bands (<3, 3-10, 10-25, 25+)
// rather than trimmed across all sizes, because a 40-acre yard and a 2-acre
// lot are priced differently per acre and both can be legitimate.

import { annualRent } from "./engine";
import {
  BANDS,
  bandOf,
  tierOf,
  type AcreageBand,
  type CompType,
  type LeaseComp,
  type NormalizedComp,
  type SaleComp,
} from "./comp-adapter";
import type { Tenant } from "./types";

export const MIN_COMPS = 5;
/** A subject more than this multiple of the largest comp acreage is out of the pool's size range. */
export const OVERSIZE_FACTOR = 2;

export interface SelectOptions {
  market: string;
  /** Look-back window. Default 36. */
  months?: 24 | 36;
  /** Reference date; injected so results are reproducible. */
  asOf: string;
}

/** PERCENTILE.INC: linear interpolation between closest ranks. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = p * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

function monthsBefore(asOf: string, months: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export interface Selection<T extends NormalizedComp> {
  /** Usable in stats: in market and window, confirmed, convertible, not a duplicate. */
  usable: T[];
  /** In market and window and confirmed, but left out, with why. */
  excluded: { duplicate: T[]; notConvertible: T[] };
  /** Count per evidence tier among the in-window comps (verified is always 0 for now). */
  tiers: { confirmed: number; screened: number; verified: number };
  windowStart: string;
}

/** Market + window + status confirmed. Future-dated comps (signed, not yet commenced) are kept. */
export function selectComps<T extends NormalizedComp>(comps: readonly T[], compType: CompType, opts: SelectOptions): Selection<T> {
  const windowStart = monthsBefore(opts.asOf, opts.months ?? 36);
  const market = opts.market.trim().toLowerCase();
  const inScope = comps.filter(
    (c) =>
      c.compType === compType &&
      (c.market ?? "").trim().toLowerCase() === market &&
      c.status === "confirmed" &&
      !!c.date &&
      c.date >= windowStart
  );
  const duplicate = inScope.filter((c) => c.flags.includes("suspect_duplicate"));
  const notConvertible = inScope.filter((c) => !c.flags.includes("suspect_duplicate") && c.flags.includes("not_convertible"));
  const usable = inScope.filter((c) => !c.flags.includes("suspect_duplicate") && !c.flags.includes("not_convertible"));
  const tiers = { confirmed: 0, screened: 0, verified: 0 };
  for (const c of inScope) {
    const t = tierOf(c);
    if (t === "screened") tiers.screened++;
    if (t) tiers.confirmed++; // screened is a subset of confirmed
  }
  return { usable, excluded: { duplicate, notConvertible }, tiers, windowStart };
}

export interface Summary {
  n: number;
  min: number | null;
  max: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  compIds: string[];
}

/** p25 / median / p75 as downside / base / upside (rent and price per acre). */
export interface Scenarios {
  downside: number | null;
  base: number | null;
  upside: number | null;
}

export function summarize(comps: readonly NormalizedComp[]): Summary {
  const values = comps.map((c) => c.valuePerAcre!).filter((v) => v !== null);
  return {
    n: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    compIds: comps.map((c) => c.id),
  };
}

const scenarios = (s: Summary): Scenarios => ({ downside: s.p25, base: s.median, upside: s.p75 });

export interface ValueStatsOk {
  status: "ok";
  compType: CompType;
  /**
   * Set on rent stats when the subject is more than 2x the largest comp in the
   * pool: the numbers describe smaller lots and are not a rent for the subject.
   */
  reference?: "small-lot reference only";
  /** "band" when the subject's band had >= 5 comps, else "market" (fallback). */
  basis: "band" | "market";
  subjectBand: AcreageBand | null;
  /** All usable comps in the pool, review_extreme included. */
  withExtreme: Summary & Scenarios;
  /** The same pool without review_extreme comps. Null if that leaves none. */
  withoutExtreme: (Summary & Scenarios) | null;
  /** Lease only: the pool without comps whose NNN status is "assumed". */
  withoutAssumedNnn?: (Summary & Scenarios) | null;
  extremeIds: string[];
  /** Acreage range of the comps used. */
  acresRange: { min: number; max: number } | null;
  warnings: string[];
}

export interface ValueStatsInsufficient {
  status: "insufficient";
  compType: CompType;
  /** "market": fewer than 5 usable comps. "size": sale subject over 2x the largest comp. */
  reason: "market" | "size";
  /** Usable comps in the market (reason "market") or in the pool (reason "size"). */
  n: number;
  /** Reason "size": the largest comp acreage in the pool. */
  largestCompAcres?: number;
  message: string;
  warnings: string[];
}

export type ValueStats = ValueStatsOk | ValueStatsInsufficient;

const fmtAc = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/**
 * Banded stats for one comp type. Uses the subject's acreage band when it has
 * at least 5 usable comps; otherwise the whole market, with a warning; and
 * "insufficient comps" when the market itself has fewer than 5.
 *
 * Size: when the subject is more than 2x the largest comp in the pool, sale
 * price returns "insufficient comps for this size" with no numbers, and rent
 * is returned but labelled "small-lot reference only".
 */
export function valueStats(
  usable: readonly NormalizedComp[],
  compType: CompType,
  subjectAcres: number | null
): ValueStats {
  return statsForBand(usable, compType, bandOf(subjectAcres), subjectAcres);
}

function statsForBand(
  usable: readonly NormalizedComp[],
  compType: CompType,
  subjectBand: AcreageBand | null,
  subjectAcres: number | null
): ValueStats {
  const warnings: string[] = [];
  const label = compType === "lease" ? "lease" : "sale";
  if (usable.length < MIN_COMPS) {
    return {
      status: "insufficient",
      compType,
      reason: "market",
      n: usable.length,
      message: `insufficient comps: ${usable.length} usable ${label} comp${usable.length === 1 ? "" : "s"} in the market (need ${MIN_COMPS})`,
      warnings,
    };
  }

  let pool: readonly NormalizedComp[] = usable;
  let basis: "band" | "market" = "market";
  if (subjectBand) {
    const inBand = usable.filter((c) => c.band === subjectBand);
    if (inBand.length >= MIN_COMPS) {
      pool = inBand;
      basis = "band";
    } else {
      warnings.push(
        `Only ${inBand.length} ${label} comp${inBand.length === 1 ? "" : "s"} in the ${subjectBand} ac band; using all ${usable.length} in the market, across sizes.`
      );
    }
  } else {
    warnings.push("No subject acreage; using the whole market across sizes.");
  }

  const acres = pool.map((c) => c.acres!).filter((a) => a !== null);
  const acresRange = acres.length ? { min: Math.min(...acres), max: Math.max(...acres) } : null;
  if (subjectAcres !== null && acresRange && (subjectAcres < acresRange.min || subjectAcres > acresRange.max)) {
    warnings.push(
      `Subject ${fmtAc(subjectAcres)} ac is outside the ${fmtAc(acresRange.min)}-${fmtAc(acresRange.max)} ac range of the ${label} comps used.`
    );
  }

  // Much bigger than anything in the pool. Price per acre falls with size, so
  // small-lot sales would overstate the subject's value: no price numbers at
  // all. Rent stats are still returned, labelled as a small-lot reference.
  const oversized = subjectAcres !== null && acresRange !== null && subjectAcres > OVERSIZE_FACTOR * acresRange.max;
  let reference: ValueStatsOk["reference"];
  if (oversized) {
    const vs = `subject ${fmtAc(subjectAcres!)} ac is more than ${OVERSIZE_FACTOR}x the largest ${label} comp in the pool (${fmtAc(acresRange!.max)} ac)`;
    if (compType === "sale") {
      return {
        status: "insufficient",
        compType,
        reason: "size",
        n: pool.length,
        largestCompAcres: acresRange!.max,
        message: `insufficient comps for this size: ${vs}`,
        warnings: [...warnings, `No price per acre: the largest sale comp in the pool is ${fmtAc(acresRange!.max)} ac.`],
      };
    }
    reference = "small-lot reference only";
    warnings.push(`Small-lot reference only: ${vs}.`);
  }

  const extreme = pool.filter((c) => c.flags.includes("review_extreme"));
  const withExtreme = summarize(pool);
  const without = pool.filter((c) => !c.flags.includes("review_extreme"));
  const withoutSummary = without.length ? summarize(without) : null;
  if (extreme.length) {
    warnings.push(`${extreme.length} review_extreme comp${extreme.length === 1 ? "" : "s"} in the pool; see results without them.`);
  }

  let withoutAssumedNnn: ValueStatsOk["withoutAssumedNnn"];
  if (compType === "lease") {
    const stated = (pool as readonly LeaseComp[]).filter((c) => c.nnnStatus !== "assumed");
    withoutAssumedNnn = stated.length ? { ...summarize(stated), ...scenarios(summarize(stated)) } : null;
    const assumed = pool.length - stated.length;
    if (assumed) warnings.push(`${assumed} of ${pool.length} lease comps have no stated lease type and are assumed NNN.`);
  }

  return {
    status: "ok",
    compType,
    ...(reference ? { reference } : {}),
    basis,
    subjectBand,
    withExtreme: { ...withExtreme, ...scenarios(withExtreme) },
    withoutExtreme: withoutSummary ? { ...withoutSummary, ...scenarios(withoutSummary) } : null,
    ...(compType === "lease" ? { withoutAssumedNnn } : {}),
    extremeIds: extreme.map((c) => c.id),
    acresRange,
    warnings,
  };
}

export type ExitCapStats =
  | { source: "manual"; n: number; message: string }
  | { source: "comps"; n: number; min: number; max: number; downside: number; base: number; upside: number; compIds: string[] };

/**
 * Exit cap from sale comps with a cap rate. No comp has one today, so this is
 * "manual" until a market has at least 5. Caps never come from a guessed NOI.
 * Higher cap = lower value, so downside is the 75th percentile.
 */
export function exitCapStats(usableSales: readonly SaleComp[]): ExitCapStats {
  const withCap = usableSales.filter((c) => c.capRate !== null);
  if (withCap.length < MIN_COMPS) {
    return {
      source: "manual",
      n: withCap.length,
      message: `Exit cap is a manual input: ${withCap.length} sale comp${withCap.length === 1 ? "" : "s"} in the market have a cap rate (need ${MIN_COMPS}).`,
    };
  }
  const caps = withCap.map((c) => c.capRate!);
  return {
    source: "comps",
    n: caps.length,
    min: Math.min(...caps),
    max: Math.max(...caps),
    downside: percentile(caps, 0.75)!,
    base: percentile(caps, 0.5)!,
    upside: percentile(caps, 0.25)!,
    compIds: withCap.map((c) => c.id),
  };
}

/** Rent stats for every acreage band, for marking a rent roll to market. */
export interface RentBands {
  market: string;
  byBand: Record<AcreageBand, ValueStats>;
}

export function rentBands(usableLeases: readonly LeaseComp[], market: string): RentBands {
  const byBand = Object.fromEntries(
    BANDS.map((b) => [b, statsForBand(usableLeases, "lease", b, null)])
  ) as Record<AcreageBand, ValueStats>;
  return { market, byBand };
}

export interface MarkToMarketRow {
  tenant: string;
  acres: number | null;
  /** In-place rent per acre per month (before growth, at 100% include). */
  rentPerAcreMo: number | null;
  band: AcreageBand | null;
  /** "band", or "market" when the band was too thin and the market was used. */
  basis: "band" | "market" | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  /** In-place rent / market median - 1. */
  vsMedian: number | null;
  position: "below" | "within" | "above" | "n/a";
  note?: string;
}

/**
 * Each rent-roll tenant's rent per acre against the p25 / median / p75 of
 * its own acreage band (review_extreme comps included, as in the headline
 * stats). Tenants with no acreage return "n/a".
 */
export function markToMarket(tenants: readonly Tenant[], bands: RentBands): MarkToMarketRow[] {
  return tenants.map((t) => {
    const base = { tenant: t.name, acres: t.acres, rentPerAcreMo: null, band: null, basis: null, p25: null, median: null, p75: null, vsMedian: null };
    if (!t.acres || !(t.acres > 0)) return { ...base, position: "n/a" as const, note: "no acreage on the rent roll" };
    const band = bandOf(t.acres)!;
    const rentPerAcreMo = annualRent(t) / 12 / t.acres;
    const stats = bands.byBand[band];
    if (stats.status !== "ok") return { ...base, rentPerAcreMo, band, position: "n/a" as const, note: stats.message };
    const { p25, median, p75 } = stats.withExtreme;
    const position = p25 !== null && rentPerAcreMo < p25 ? "below" : p75 !== null && rentPerAcreMo > p75 ? "above" : "within";
    return {
      tenant: t.name,
      acres: t.acres,
      rentPerAcreMo,
      band,
      basis: stats.basis,
      p25,
      median,
      p75,
      vsMedian: median ? rentPerAcreMo / median - 1 : null,
      position,
      ...(stats.basis === "market" ? { note: `fewer than ${MIN_COMPS} comps in the ${band} ac band; compared with the whole market` } : {}),
    };
  });
}
