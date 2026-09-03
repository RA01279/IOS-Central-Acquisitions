// lib/comps/match.ts
//
// Scores comps against the property being underwritten and derives a suggested
// range. Pure functions with no I/O, so the same code runs on the server for
// the initial render and in the browser as filters are adjusted -- and so it
// can be tested against known numbers, which matters when the output lands in
// a market leasing assumption.
//
// UNITS ARE THE HARD PART. Comps arrive quoted per SF of building per month,
// per SF of building per year, per acre per month, per SF of land per month, or
// as a whole-site monthly figure -- and sales as a lump sum. Everything is
// normalised to ONE basis before being compared, because an annual rate averaged
// against a monthly one is off by 12x and looks entirely plausible.

export type CompType = "lease" | "sale";
/** Which denominator the output is expressed in. */
export type ValueBasis = "building" | "land";

const SQFT_PER_ACRE = 43560;

export interface CompRecord {
  id: string;
  comp_type: CompType;
  address: string;
  project_name?: string | null;
  city?: string | null;
  market?: string | null;
  submarket?: string | null;
  asset_class?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  building_sf?: number | null;
  lot_sf?: number | null;
  coverage_pct?: number | null;
  year_built?: number | null;
  clear_height_ft?: number | null;
  rent?: number | null;
  rent_basis?: string | null;
  lease_type?: string | null;
  date_commenced?: string | null;
  sale_price?: number | null;
  closed_on?: string | null;
  cap_rate?: number | null;
  tenant_name?: string | null;
  buyer?: string | null;
  geocode_precision?: string | null;
}

export interface Subject {
  lat: number | null;
  lng: number | null;
  buildingSf: number | null;
  lotSf: number | null;
  coveragePct: number | null;
  assetClass: string | null;
  market: string | null;
  submarket: string | null;
}

export interface MatchWeights {
  distance: number;
  recency: number;
  size: number;
  coverage: number;
  submarket: number;
}

// RECENCY DOMINATES, by explicit decision. An earlier cut weighted distance
// highest, which left a comp next door but 32 months old level with one 7.6
// miles away and 3 months old (0.768 vs 0.764, measured). In a market that has
// repriced, the stale comp next door is the more misleading of the two.
//
// The recency CURVE moved too, not just its weight -- see recencyFalloffMonths
// in scoreComps. Weight alone wouldn't have done it: under a gentle 36-month
// falloff a two-year-old comp still scored a third of a fresh one, so raising
// the weight would partly have amplified stale evidence.
//
// Coverage stays above size: a 6%-coverage yard and a 40%-coverage warehouse
// are not the same product at identical building SF.
export const DEFAULT_WEIGHTS: MatchWeights = {
  recency: 0.4,
  distance: 0.25,
  coverage: 0.15,
  size: 0.12,
  submarket: 0.08,
};

export interface MatchOptions {
  basis?: ValueBasis;
  /** Comps beyond this are excluded outright, not merely scored low. */
  radiusMiles?: number;
  /** Comps older than this are excluded outright. */
  maxAgeMonths?: number;
  /** Distance at which the distance score reaches zero. */
  distanceFalloffMi?: number;
  /** Age at which the recency score reaches zero. */
  recencyFalloffMonths?: number;
  weights?: MatchWeights;
  /** How many of the best comps feed the range. */
  topN?: number;
  /** Comp ids the user has ruled out by hand. */
  excludedIds?: string[];
  /** Reference date for age; defaults to today. Injected so tests are stable. */
  today?: Date;
}

export interface ScoredComp {
  comp: CompRecord;
  distanceMi: number | null;
  ageMonths: number | null;
  /** Normalised to the requested basis. Null when it can't be derived. */
  unitValue: number | null;
  score: number;
  factors: {
    distance: number | null;
    recency: number | null;
    size: number | null;
    coverage: number | null;
    submarket: number;
  };
  /** Set when the comp can't take part, with the reason. */
  excluded?: string;
  /** True when the user ruled it out rather than the filters. */
  excludedByUser?: boolean;
  /** Among the top N feeding the range. */
  inRange: boolean;
}

export interface SuggestedRange {
  basis: ValueBasis;
  compType: CompType;
  /** Weighted mean of the contributing comps. */
  mid: number | null;
  /** 25th and 75th percentile of the contributing values. */
  low: number | null;
  high: number | null;
  count: number;
  /** Total weight behind `mid`, for transparency. */
  weight: number;
  /** Plain-language caveats to show beside the number. */
  caveats: string[];
}

export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const q =
    Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function acresOf(comp: CompRecord): number | null {
  return comp.lot_sf ? Number(comp.lot_sf) / SQFT_PER_ACRE : null;
}

/**
 * The comp's value in one consistent unit:
 *   lease + building -> $ / SF of building / month
 *   lease + land     -> $ / SF of land / month
 *   sale  + building -> $ / SF of building
 *   sale  + land     -> $ / SF of land
 * Null when the areas needed for the conversion are missing -- better absent
 * than invented.
 */
export function unitValue(comp: CompRecord, basis: ValueBasis): number | null {
  const bldg = comp.building_sf ? Number(comp.building_sf) : null;
  const land = comp.lot_sf ? Number(comp.lot_sf) : null;
  const denom = basis === "building" ? bldg : land;
  if (!denom) return null;

  if (comp.comp_type === "sale") {
    return comp.sale_price ? Number(comp.sale_price) / denom : null;
  }

  const rent = comp.rent ? Number(comp.rent) : null;
  if (!rent) return null;

  // Convert whatever basis it was quoted in into a total monthly rent first,
  // then divide by the chosen denominator. One conversion path, so a new basis
  // only has to be handled once.
  let totalMonthly: number | null = null;
  switch (comp.rent_basis) {
    case "total_monthly":
      totalMonthly = rent;
      break;
    case "per_sf_bldg_monthly":
      totalMonthly = bldg ? rent * bldg : null;
      break;
    case "per_sf_bldg_annual":
      totalMonthly = bldg ? (rent * bldg) / 12 : null;
      break;
    case "per_acre_monthly": {
      const ac = acresOf(comp);
      totalMonthly = ac ? rent * ac : null;
      break;
    }
    case "per_sf_land_monthly":
      totalMonthly = land ? rent * land : null;
      break;
    default:
      totalMonthly = null;
  }
  return totalMonthly === null ? null : totalMonthly / denom;
}

/** Months between a comp's date and the reference date. */
export function ageMonths(comp: CompRecord, today: Date): number | null {
  const iso = comp.comp_type === "sale" ? comp.closed_on : comp.date_commenced;
  if (!iso) return null;
  const then = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  return (today.getTime() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

/** 1 at zero, 0 at the falloff point, linear between. */
function falloff(value: number, zeroAt: number): number {
  if (zeroAt <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - value / zeroAt));
}

/** Similarity of two magnitudes, 1 when identical. */
function ratioScore(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!a || !b) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return hi === 0 ? null : lo / hi;
}

export function scoreComps(
  comps: CompRecord[],
  subject: Subject,
  compType: CompType,
  opts: MatchOptions = {}
): ScoredComp[] {
  const {
    basis = "building",
    radiusMiles = 15,
    // Two years, matching the falloff below: a comp whose recency score has
    // decayed to nothing shouldn't still be dragging an average around.
    maxAgeMonths = 24,
    distanceFalloffMi = 12,
    // Steep on purpose. At 36 months a two-year-old comp still scored 0.33 on
    // recency, which -- once recency became the heaviest factor -- would have
    // amplified stale evidence rather than discounting it. At 24, a one-year-old
    // comp scores 0.5 and a two-year-old scores 0.
    recencyFalloffMonths = 24,
    weights = DEFAULT_WEIGHTS,
    topN = 8,
    excludedIds = [],
    today = new Date(),
  } = opts;

  const excluded = new Set(excludedIds);

  const scored: ScoredComp[] = comps
    .filter((c) => c.comp_type === compType)
    .map((c) => {
      const distanceMi =
        subject.lat != null && subject.lng != null && c.latitude != null && c.longitude != null
          ? haversineMiles(subject.lat, subject.lng, Number(c.latitude), Number(c.longitude))
          : null;
      const age = ageMonths(c, today);
      const value = unitValue(c, basis);

      const fDistance = distanceMi === null ? null : falloff(distanceMi, distanceFalloffMi);
      const fRecency = age === null ? null : falloff(Math.max(0, age), recencyFalloffMonths);
      const fSize = ratioScore(subject.buildingSf, c.building_sf ? Number(c.building_sf) : null);
      const fCoverage =
        subject.coveragePct != null && c.coverage_pct != null
          ? Math.max(0, 1 - Math.abs(subject.coveragePct - Number(c.coverage_pct)) / 0.25)
          : null;
      const fSubmarket =
        subject.submarket && c.submarket && subject.submarket.toLowerCase() === c.submarket.toLowerCase()
          ? 1
          : 0;

      // Only factors we actually know contribute, and the weights are
      // renormalised over those -- otherwise a comp missing coverage would be
      // penalised for our missing data rather than judged on its own merits.
      const parts: [number, number][] = [
        [fDistance ?? NaN, weights.distance],
        [fRecency ?? NaN, weights.recency],
        [fSize ?? NaN, weights.size],
        [fCoverage ?? NaN, weights.coverage],
        [fSubmarket, weights.submarket],
      ];
      let sum = 0;
      let known = 0;
      for (const [v, w] of parts) {
        if (!Number.isNaN(v)) {
          sum += v * w;
          known += w;
        }
      }
      const score = known > 0 ? sum / known : 0;

      let exclusion: string | undefined;
      if (excluded.has(c.id)) exclusion = "ruled out";
      else if (value === null) exclusion = basis === "building" ? "no building SF" : "no land area";
      else if (distanceMi === null) exclusion = "not located";
      else if (distanceMi > radiusMiles) exclusion = `${distanceMi.toFixed(1)} mi away`;
      else if (age === null) exclusion = "no date";
      else if (age > maxAgeMonths) exclusion = `${Math.round(age)} months old`;

      return {
        comp: c,
        distanceMi,
        ageMonths: age,
        unitValue: value,
        score,
        factors: {
          distance: fDistance,
          recency: fRecency,
          size: fSize,
          coverage: fCoverage,
          submarket: fSubmarket,
        },
        excluded: exclusion,
        excludedByUser: excluded.has(c.id),
        inRange: false,
      };
    })
    .sort((a, b) => {
      // Eligible comps first, then by score.
      if (!!a.excluded !== !!b.excluded) return a.excluded ? 1 : -1;
      return b.score - a.score;
    });

  // Mark the top N eligible comps as the ones feeding the range.
  let taken = 0;
  for (const s of scored) {
    if (!s.excluded && taken < topN) {
      s.inRange = true;
      taken++;
    }
  }
  return scored;
}

/** Weighted percentile over (value, weight) pairs, values pre-sorted ascending. */
function weightedPercentile(sorted: [number, number][], p: number): number | null {
  if (!sorted.length) return null;
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return sorted[Math.floor((sorted.length - 1) * p)][0];
  const target = total * p;
  let cum = 0;
  for (const [v, w] of sorted) {
    cum += w;
    if (cum >= target) return v;
  }
  return sorted[sorted.length - 1][0];
}

export function suggestRange(
  scored: ScoredComp[],
  compType: CompType,
  basis: ValueBasis
): SuggestedRange {
  const contributing = scored.filter((s) => s.inRange && s.unitValue !== null);
  const caveats: string[] = [];

  if (!contributing.length) {
    const ruledOut = scored.filter((s) => s.excluded).length;
    caveats.push(
      scored.length === 0
        ? `No ${compType} comps in the repository yet.`
        : `All ${ruledOut} ${compType} comp${ruledOut === 1 ? "" : "s"} were filtered out — widen the radius or the age limit.`
    );
    return { basis, compType, mid: null, low: null, high: null, count: 0, weight: 0, caveats };
  }

  // Score is the weight, floored so a weak-but-included comp still counts for
  // something rather than vanishing from its own average.
  const pairs: [number, number][] = contributing.map((s) => [s.unitValue!, Math.max(s.score, 0.05)]);
  const weight = pairs.reduce((s, [, w]) => s + w, 0);
  const mid = pairs.reduce((s, [v, w]) => s + v * w, 0) / weight;

  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const low = weightedPercentile(sorted, 0.25);
  const high = weightedPercentile(sorted, 0.75);

  if (contributing.length < 3) {
    caveats.push(
      `Only ${contributing.length} comp${contributing.length === 1 ? "" : "s"} behind this — thin evidence.`
    );
  }
  const farthest = Math.max(...contributing.map((s) => s.distanceMi ?? 0));
  if (farthest > 10) {
    caveats.push(`Reaches ${farthest.toFixed(0)} miles out for evidence.`);
  }
  const oldest = Math.max(...contributing.map((s) => s.ageMonths ?? 0));
  if (oldest > 24) {
    caveats.push(`Oldest comp is ${Math.round(oldest)} months old.`);
  }
  // Several comps at one address means one property is carrying more of the
  // average than its share. That happens legitimately -- a business park
  // selling building by building produces real, separate transactions at the
  // same street address -- so they aren't collapsed, but the concentration is
  // disclosed so it can be overruled by hand.
  const byAddress = new Map<string, number>();
  for (const s of contributing) {
    const key = s.comp.address.trim().toLowerCase();
    byAddress.set(key, (byAddress.get(key) ?? 0) + 1);
  }
  const repeated = [...byAddress.entries()].filter(([, n]) => n > 1);
  if (repeated.length) {
    const worst = repeated.sort((a, b) => b[1] - a[1])[0];
    caveats.push(
      `${worst[1]} of these ${contributing.length} are the same address — one property is weighted ${worst[1]}x.`
    );
  }

  // Mixed lease structures aren't comparable rents; say so rather than blending
  // silently.
  if (compType === "lease") {
    const structures = new Set(
      contributing.map((s) => s.comp.lease_type).filter(Boolean) as string[]
    );
    if (structures.size > 1) {
      caveats.push(`Mixes lease structures (${[...structures].join(", ")}) — not directly comparable.`);
    }
  }

  return { basis, compType, mid, low, high, count: contributing.length, weight, caveats };
}

/** How the suggested figure should be written out. */
export function formatUnit(value: number | null, compType: CompType, basis: ValueBasis): string {
  if (value === null) return "—";
  if (compType === "sale") {
    return `$${value.toFixed(2)}/SF${basis === "land" ? " land" : ""}`;
  }
  return basis === "land" ? `$${value.toFixed(3)}/SF land/mo` : `$${value.toFixed(2)}/SF/mo`;
}
