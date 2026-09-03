// lib/comps/rates.ts
//
// One lease rate, shown three ways: per acre per month, per building SF per
// month, and per building SF per year.
//
// A comp is STORED in the single basis it was quoted in, which is right --
// converting on the way in would lose what the broker actually said, and the
// conversion needs an acreage or a building size that isn't always there. But
// nobody wants to do the arithmetic in their head at the moment they're
// reading a comp. IOS is quoted per acre per month, industrial is quoted per SF
// per year, and the same deal has to be argued about in both rooms.
//
// Two rules run through this file:
//
//   1. A view is null unless the number needed to derive it is actually
//      present. A per-SF rate on a comp with no building size is not a small
//      approximation, it's a fabrication.
//   2. The basis the comp was quoted in is marked, so a reader can tell the
//      stated number from the derived ones. Only one of the three is evidence;
//      the others are arithmetic done on it.

const SQFT_PER_ACRE = 43560;

export interface RateInput {
  rent?: number | string | null;
  rent_basis?: string | null;
  building_sf?: number | string | null;
  lot_sf?: number | string | null;
  /**
   * Usable yard acreage. Preferred over lot_sf for IOS: a per-acre rate is
   * negotiated on the acreage the tenant can actually use, which on a site
   * with a detention pond or an unusable slope is not the whole parcel.
   */
  yard_acres?: number | string | null;
}

export type RateBasis =
  | "per_acre_monthly"
  | "per_sf_bldg_monthly"
  | "per_sf_bldg_annual"
  | "per_sf_land_monthly"
  | "total_monthly";

export interface RateViews {
  /** Whole-site rent per month, the pivot every other view is derived from. */
  totalMonthly: number | null;
  perAcreMonthly: number | null;
  perSfBldgMonthly: number | null;
  perSfBldgAnnual: number | null;
  perSfLandMonthly: number | null;
  /** The basis actually quoted. That view is evidence; the rest are derived. */
  quoted: RateBasis | null;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) && x !== 0 ? x : null;
};

/** Acreage to price against: usable yard first, then the whole parcel. */
export function billableAcres(c: RateInput): number | null {
  const yard = n(c.yard_acres);
  if (yard) return yard;
  const lot = n(c.lot_sf);
  return lot ? lot / SQFT_PER_ACRE : null;
}

/**
 * Every view of one lease rate. Converts to a whole-site monthly rent first --
 * one conversion path, so a new basis is handled once -- then back out to each
 * unit. Views whose denominator is missing stay null.
 */
export function rateViews(c: RateInput): RateViews {
  const rent = n(c.rent);
  const bldg = n(c.building_sf);
  const landSf = n(c.lot_sf);
  const acres = billableAcres(c);
  const basis = (c.rent_basis ?? null) as RateBasis | null;

  const empty: RateViews = {
    totalMonthly: null,
    perAcreMonthly: null,
    perSfBldgMonthly: null,
    perSfBldgAnnual: null,
    perSfLandMonthly: null,
    quoted: basis,
  };
  if (!rent || !basis) return empty;

  let totalMonthly: number | null = null;
  switch (basis) {
    case "total_monthly":
      totalMonthly = rent;
      break;
    case "per_sf_bldg_monthly":
      totalMonthly = bldg ? rent * bldg : null;
      break;
    case "per_sf_bldg_annual":
      totalMonthly = bldg ? (rent * bldg) / 12 : null;
      break;
    case "per_acre_monthly":
      totalMonthly = acres ? rent * acres : null;
      break;
    case "per_sf_land_monthly":
      totalMonthly = landSf ? rent * landSf : null;
      break;
  }

  // The quoted view is always known even when the site figures needed to
  // convert it are missing -- it's the number on the page.
  const views: RateViews = { ...empty, totalMonthly };
  if (basis === "per_acre_monthly") views.perAcreMonthly = rent;
  if (basis === "per_sf_bldg_monthly") {
    views.perSfBldgMonthly = rent;
    views.perSfBldgAnnual = rent * 12;
  }
  if (basis === "per_sf_bldg_annual") {
    views.perSfBldgAnnual = rent;
    views.perSfBldgMonthly = rent / 12;
  }
  if (basis === "per_sf_land_monthly") views.perSfLandMonthly = rent;

  if (totalMonthly === null) return views;

  if (views.perAcreMonthly === null && acres) views.perAcreMonthly = totalMonthly / acres;
  if (views.perSfLandMonthly === null && landSf) views.perSfLandMonthly = totalMonthly / landSf;
  if (views.perSfBldgMonthly === null && bldg) {
    views.perSfBldgMonthly = totalMonthly / bldg;
    views.perSfBldgAnnual = (totalMonthly * 12) / bldg;
  }
  return views;
}

const money = (v: number, dp: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export function fmtPerAcre(v: number | null): string | null {
  return v === null ? null : `${money(Math.round(v), 0)}/AC/mo`;
}
export function fmtPerSfMonthly(v: number | null): string | null {
  return v === null ? null : `${money(v, 2)}/SF/mo`;
}
export function fmtPerSfAnnual(v: number | null): string | null {
  return v === null ? null : `${money(v, 2)}/SF/yr`;
}
export function fmtTotalMonthly(v: number | null): string | null {
  return v === null ? null : `${money(Math.round(v), 0)}/mo`;
}

export interface RateLine {
  label: string;
  value: string;
  /** True for the basis the comp was quoted in. */
  quoted: boolean;
}

/**
 * The three views a reader wants, in the order they're usually argued in:
 * per acre per month (how IOS is quoted), per SF per month, per SF per year
 * (how industrial is quoted). Missing views are dropped rather than shown as
 * a dash, so the line stays short when the site figures aren't there.
 */
export function rateLines(c: RateInput): RateLine[] {
  const v = rateViews(c);
  const out: RateLine[] = [];
  const push = (label: string, value: string | null, quoted: boolean) => {
    if (value !== null) out.push({ label, value, quoted });
  };
  push("Per acre", fmtPerAcre(v.perAcreMonthly), v.quoted === "per_acre_monthly");
  push("Per SF / mo", fmtPerSfMonthly(v.perSfBldgMonthly), v.quoted === "per_sf_bldg_monthly");
  push("Per SF / yr", fmtPerSfAnnual(v.perSfBldgAnnual), v.quoted === "per_sf_bldg_annual");
  return out;
}

/** All three on one line, e.g. "$6,785/AC/mo · $2.08/SF/mo · $24.95/SF/yr". */
export function rateSummary(c: RateInput): string {
  const lines = rateLines(c);
  return lines.length ? lines.map((l) => l.value).join(" · ") : "—";
}
