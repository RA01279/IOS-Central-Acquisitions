// lib/uw/comp-adapter.ts
//
// Turns raw `comps` rows into the two numbers underwriting needs:
//   lease -> rent per acre per month, NNN
//   sale  -> price per acre, and a cap rate where one exists
// plus flags that say how far each number can be trusted. Pure: takes plain
// arrays, never reads the database.
//
// Decisions from the addendum in docs/uw-build-plan.md:
//   - Acreage is lot_sf / 43560. yard_acres is unreliable (a copy of the lot
//     size on 91% of rows) and is ignored.
//   - A blank lease_type is treated as NNN but labelled "assumed", so stats
//     can be shown with and without those comps. Never mixed silently.
//   - Comps are never deleted. Duplicates and outliers get a flag and a reason.
//
// Unit meanings follow lib/comps/rates.ts (building SF for per_sf_bldg_*, land
// SF for per_sf_land_monthly); that module isn't imported because its acreage
// prefers yard_acres.

export const SQFT_PER_ACRE = 43560;
/** "Dates within about 400 days" for duplicate detection. */
export const DUPLICATE_WINDOW_DAYS = 400;
/** review_extreme: more than 3x, or less than 1/3, of the market-band median (was 5x). */
export const EXTREME_RATIO = 3;

export type CompType = "lease" | "sale";
export type AcreageBand = "<3" | "3-10" | "10-25" | "25+";
export const BANDS: readonly AcreageBand[] = ["<3", "3-10", "10-25", "25+"];

export type NnnStatus = "stated" | "stated_nn" | "assumed" | "adjusted" | "not_convertible";
export type CompFlag = "suspect_duplicate" | "not_convertible" | "review_extreme" | "market_conflict";

/** The `comps` columns the adapter reads. Numerics may arrive as strings from PostgREST. */
export interface CompRow {
  id: string;
  comp_type: CompType;
  address: string;
  project_name?: string | null;
  suite?: string | null;
  market?: string | null;
  submarket?: string | null;
  status?: string | null;
  source_ref?: string | null;
  lot_sf?: number | string | null;
  building_sf?: number | string | null;
  rent?: number | string | null;
  rent_basis?: string | null;
  lease_type?: string | null;
  cam_psf_annual?: number | string | null;
  escalations_pct?: number | string | null;
  date_commenced?: string | null;
  sale_price?: number | string | null;
  closed_on?: string | null;
  cap_rate?: number | string | null;
  noi?: number | string | null;
}

interface CompBase {
  id: string;
  compType: CompType;
  address: string;
  /** ISO date: commencement for a lease, close for a sale. */
  date: string | null;
  market: string | null;
  submarket: string | null;
  sourceRef: string | null;
  status: string | null;
  /** lot_sf / 43560. */
  acres: number | null;
  band: AcreageBand | null;
  /** The headline value per acre: rent/acre/month for a lease, price/acre for a sale. */
  valuePerAcre: number | null;
  flags: CompFlag[];
  /** Why each flag was raised, keyed by flag. */
  reasons: Partial<Record<CompFlag, string>>;
  /** valuePerAcre / median of its market and band; set when that median exists. */
  ratioToBandMedian?: number;
}

export interface LeaseComp extends CompBase {
  compType: "lease";
  rentPerAcreMo: number | null;
  nnnStatus: NnnStatus;
  /** As a fraction (0.03), whatever the source stored. */
  escalation: number | null;
  quotedRent: number | null;
  quotedBasis: string | null;
}

export interface SaleComp extends CompBase {
  compType: "sale";
  pricePerAcre: number | null;
  capRate: number | null;
  capRateSource: "stated" | "noi" | null;
}

export type NormalizedComp = LeaseComp | SaleComp;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const pos = (v: unknown): number | null => {
  const x = num(v);
  return x !== null && x > 0 ? x : null;
};

export function bandOf(acres: number | null): AcreageBand | null {
  if (acres === null || !(acres > 0)) return null;
  if (acres < 3) return "<3";
  if (acres < 10) return "3-10";
  if (acres < 25) return "10-25";
  return "25+";
}

/** Values above 1 are whole percents (3 -> 0.03); the rest are already fractions. */
export function normalizeEscalation(v: unknown): number | null {
  const x = num(v);
  if (x === null) return null;
  return x > 1 ? x / 100 : x;
}

/** Whole-site monthly rent from the quoted basis. Null when a needed area is missing. */
export function totalMonthlyRent(row: CompRow): number | null {
  const rent = pos(row.rent);
  if (rent === null) return null;
  const bldg = pos(row.building_sf);
  const land = pos(row.lot_sf);
  switch (row.rent_basis) {
    case "total_monthly":
      return rent;
    case "per_sf_bldg_monthly":
      return bldg ? rent * bldg : null;
    case "per_sf_bldg_annual":
      return bldg ? (rent * bldg) / 12 : null;
    case "per_sf_land_monthly":
      return land ? rent * land : null;
    case "per_acre_monthly":
      return land ? rent * (land / SQFT_PER_ACRE) : null;
    default:
      return null;
  }
}

const STATED = new Set(["nnn", "absolute_net"]);
const GROSS = new Set(["gross", "modified_gross", "industrial_gross"]);

export function normalizeLease(row: CompRow): LeaseComp {
  const land = pos(row.lot_sf);
  const acres = land ? land / SQFT_PER_ACRE : null;
  const lt = (row.lease_type ?? "").trim().toLowerCase();
  const reasons: LeaseComp["reasons"] = {};

  // Rent per acre before any NNN adjustment. per_acre_monthly is already the
  // answer; every other basis goes through whole-site monthly rent.
  let gross: number | null = null;
  if (row.rent_basis === "per_acre_monthly") gross = pos(row.rent);
  else {
    const total = totalMonthlyRent(row);
    gross = total !== null && acres ? total / acres : null;
  }

  let nnnStatus: NnnStatus;
  let rentPerAcreMo: number | null = gross;
  if (STATED.has(lt)) nnnStatus = "stated";
  else if (lt === "nn") nnnStatus = "stated_nn";
  else if (lt === "") nnnStatus = "assumed";
  else if (GROSS.has(lt)) {
    const cam = pos(row.cam_psf_annual);
    const bldg = pos(row.building_sf);
    if (gross !== null && cam !== null && bldg !== null && acres) {
      nnnStatus = "adjusted";
      rentPerAcreMo = gross - (cam * bldg) / 12 / acres;
    } else {
      nnnStatus = "not_convertible";
      rentPerAcreMo = null;
      reasons.not_convertible = `${lt} rent with no CAM and building SF to net it down`;
    }
  } else {
    nnnStatus = "not_convertible";
    rentPerAcreMo = null;
    reasons.not_convertible = `lease structure "${lt}" can't be put on an NNN basis`;
  }

  if (rentPerAcreMo !== null && acres === null) {
    // per_acre_monthly with no lot_sf: the rate is known, but it can't be banded
    // or checked against a site size, so it can't feed acreage-banded stats.
    rentPerAcreMo = null;
    reasons.not_convertible = "no lot_sf, so no acreage";
  } else if (rentPerAcreMo === null && !reasons.not_convertible) {
    reasons.not_convertible = !acres
      ? "no lot_sf, so no acreage"
      : `${row.rent_basis ?? "no basis"} quote is missing the area needed to convert it`;
  }
  if (rentPerAcreMo !== null && !(rentPerAcreMo > 0)) {
    rentPerAcreMo = null;
    reasons.not_convertible = "rent per acre is zero or negative after the NNN adjustment";
  }
  if (rentPerAcreMo === null && nnnStatus !== "not_convertible") nnnStatus = "not_convertible";

  return {
    id: row.id,
    compType: "lease",
    address: row.address,
    date: row.date_commenced ?? null,
    market: row.market ?? null,
    submarket: row.submarket ?? null,
    sourceRef: row.source_ref ?? null,
    status: row.status ?? null,
    acres,
    band: bandOf(acres),
    valuePerAcre: rentPerAcreMo,
    flags: rentPerAcreMo === null ? ["not_convertible"] : [],
    reasons,
    rentPerAcreMo,
    nnnStatus,
    escalation: normalizeEscalation(row.escalations_pct),
    quotedRent: num(row.rent),
    quotedBasis: row.rent_basis ?? null,
  };
}

export function normalizeSale(row: CompRow): SaleComp {
  const land = pos(row.lot_sf);
  const acres = land ? land / SQFT_PER_ACRE : null;
  const price = pos(row.sale_price);
  const pricePerAcre = price !== null && acres ? price / acres : null;
  const stated = pos(row.cap_rate);
  const noi = pos(row.noi);
  const capRate = stated ?? (noi !== null && price !== null ? noi / price : null);
  const reasons: SaleComp["reasons"] = {};
  if (pricePerAcre === null) reasons.not_convertible = !acres ? "no lot_sf, so no acreage" : "no sale price";
  return {
    id: row.id,
    compType: "sale",
    address: row.address,
    date: row.closed_on ?? null,
    market: row.market ?? null,
    submarket: row.submarket ?? null,
    sourceRef: row.source_ref ?? null,
    status: row.status ?? null,
    acres,
    band: bandOf(acres),
    valuePerAcre: pricePerAcre,
    flags: pricePerAcre === null ? ["not_convertible"] : [],
    reasons,
    pricePerAcre,
    capRate,
    capRateSource: stated !== null ? "stated" : capRate !== null ? "noi" : null,
  };
}

/**
 * Address key for duplicate detection: case, punctuation and the common
 * street-suffix spellings ("Road"/"Rd", "South"/"S") don't make two comps
 * different properties.
 */
export function normalizeAddress(address: string): string {
  const words: Record<string, string> = {
    road: "rd", street: "st", drive: "dr", avenue: "ave", boulevard: "blvd", lane: "ln",
    parkway: "pkwy", highway: "hwy", freeway: "fwy", circle: "cir", court: "ct", place: "pl",
    trail: "trl", north: "n", south: "s", east: "e", west: "w", suite: "ste",
  };
  return address
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => words[w] ?? w)
    .join(" ");
}

const dayMs = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / dayMs;

function addFlag(c: NormalizedComp, flag: CompFlag, reason: string) {
  if (!c.flags.includes(flag)) c.flags.push(flag);
  c.reasons[flag] = reason;
}

/** Rent or price within 1% counts as the same amount ($4,839 vs $4,838.71). */
export const DUPLICATE_AMOUNT_TOLERANCE = 0.01;

export function sameAmount(a: number, b: number): boolean {
  const hi = Math.max(Math.abs(a), Math.abs(b));
  return hi === 0 || Math.abs(a - b) <= DUPLICATE_AMOUNT_TOLERANCE * hi;
}

/**
 * suspect_duplicate: same comp type, normalized address, project and suite,
 * rent (same basis) or sale price within 1%, and dates within ~400 days.
 * The LATER date is kept; each earlier one is flagged with the id it duplicates.
 * Project and suite are in the key because a business park selling building
 * by building, or a rent roll's suites, are genuinely separate comps.
 *
 * NEEDS A HUMAN CHECK: nearly all lease duplicates come from the
 * "TX IOS Lease Comps (ver.2.0).xlsx" import, in pairs dated the 1st of a
 * month and the 22nd-24th of the same month (23 days apart) or of the same
 * month a year later (~388 days apart). That looks like a date-parsing error
 * in that import, not a re-lease. Keeping the later date is the agreed rule,
 * but for the ~388-day pairs it may make a comp look a year more recent than
 * it is. Resolve before the reviewed exclusion migration.
 */
export function flagDuplicates(comps: NormalizedComp[], rows: ReadonlyMap<string, CompRow>): void {
  const groups = new Map<string, Array<{ c: NormalizedComp; amount: number }>>();
  for (const c of comps) {
    const row = rows.get(c.id);
    const amount = row ? num(c.compType === "lease" ? row.rent : row.sale_price) : null;
    if (!row || !c.date || amount === null) continue;
    const key = [
      c.compType,
      normalizeAddress(c.address),
      (row.project_name ?? "").trim().toLowerCase(),
      (row.suite ?? "").trim().toLowerCase(),
      c.compType === "lease" ? row.rent_basis ?? "" : "",
    ].join("|");
    const list = groups.get(key) ?? [];
    list.push({ c, amount });
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Latest first; anything with a later twin (same amount within 1%, dated
    // inside the window) is a duplicate of it.
    list.sort((a, b) => b.c.date!.localeCompare(a.c.date!) || a.c.id.localeCompare(b.c.id));
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      const later = list
        .slice(0, i)
        .find(
          (k) =>
            !k.c.flags.includes("suspect_duplicate") &&
            sameAmount(k.amount, cur.amount) &&
            daysBetween(k.c.date!, cur.c.date!) <= DUPLICATE_WINDOW_DAYS
        );
      if (later) {
        const days = Math.round(daysBetween(later.c.date!, cur.c.date!));
        addFlag(
          cur.c,
          "suspect_duplicate",
          `same address and ${cur.c.compType === "lease" ? "rent" : "price"}${later.amount === cur.amount ? "" : " (within 1%)"} as ${later.c.id} (${later.c.date}), ${days} days apart`
        );
      }
    }
  }
}

/**
 * market_conflict: the same normalized address recorded under two or more
 * markets (e.g. 2950 Roy Orr Blvd as both Dallas and Fort Worth). Every comp
 * at that address is flagged; none is excluded. A blank market is unknown,
 * not a conflict.
 */
export function flagMarketConflicts(comps: NormalizedComp[]): void {
  const byAddress = new Map<string, NormalizedComp[]>();
  for (const c of comps) {
    const key = normalizeAddress(c.address);
    const list = byAddress.get(key) ?? [];
    list.push(c);
    byAddress.set(key, list);
  }
  for (const list of byAddress.values()) {
    const markets = [...new Set(list.map((c) => c.market?.trim()).filter((m): m is string => !!m))];
    const distinct = new Set(markets.map((m) => m.toLowerCase()));
    if (distinct.size < 2) continue;
    for (const c of list) addFlag(c, "market_conflict", `address recorded in ${markets.join(" and ")}`);
  }
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * review_extreme: value per acre more than 3x, or under 1/3, of the median of
 * its market and acreage band (same comp type, duplicates and unconvertible
 * comps left out of the median). Kept in stats, but counted and listed. The
 * ratio is recorded on the comp so a report can show how far out it is.
 */
export function flagExtremes(comps: NormalizedComp[]): void {
  const groups = new Map<string, NormalizedComp[]>();
  for (const c of comps) {
    if (c.valuePerAcre === null || !c.band || c.flags.includes("suspect_duplicate")) continue;
    const key = `${c.compType}|${(c.market ?? "").toLowerCase()}|${c.band}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    const m = median(list.map((c) => c.valuePerAcre!));
    if (m === null || m <= 0) continue;
    for (const c of list) {
      const ratio = c.valuePerAcre! / m;
      c.ratioToBandMedian = ratio;
      if (ratio > EXTREME_RATIO || ratio < 1 / EXTREME_RATIO) {
        addFlag(c, "review_extreme", `${ratio.toFixed(2)}x the ${c.market} ${c.band} ac median (${Math.round(m).toLocaleString("en-US")})`);
      }
    }
  }
}

/** Normalize every row and raise the duplicate and extreme flags. */
export function adaptComps(rows: readonly CompRow[]): NormalizedComp[] {
  const comps: NormalizedComp[] = rows.map((r) => (r.comp_type === "sale" ? normalizeSale(r) : normalizeLease(r)));
  flagDuplicates(comps, new Map(rows.map((r) => [r.id, r])));
  flagMarketConflicts(comps);
  flagExtremes(comps);
  return comps;
}

/**
 * Evidence tiers from the addendum:
 *   confirmed -- status 'confirmed'
 *   screened  -- confirmed, not a suspect duplicate or extreme, has a
 *                source_ref and an acreage (automatic)
 *   verified  -- human-reviewed; needs verified_at / verified_by columns,
 *                which don't exist yet, so nothing qualifies
 */
export function tierOf(c: NormalizedComp): "verified" | "screened" | "confirmed" | null {
  if (c.status !== "confirmed") return null;
  const screened =
    !c.flags.includes("suspect_duplicate") &&
    !c.flags.includes("review_extreme") &&
    !!c.sourceRef?.trim() &&
    c.acres !== null;
  return screened ? "screened" : "confirmed";
}
