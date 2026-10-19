// lib/asset-performance.ts
//
// Underwritten vs actual for an owned asset. "Underwritten" is the closing
// deal's latest model version (returns summary) and its in-place rent;
// "actual" is the asset's rent roll (asset_leases) against what we paid.
// Pure, so the test can feed it rows.

export type Lease = {
  id: string;
  tenant: string;
  suite: string | null;
  leased_sf: number | null;
  leased_acres: number | null;
  commenced_on: string | null;
  expires_on: string | null;
  base_rent_monthly: number | null;
  escalation_pct: number | null;
  lease_type: string | null;
  options: string | null;
  status: string;
  notes: string | null;
};

export const LEASE_TYPE_LABELS: Record<string, string> = {
  nnn: "NNN",
  modified_gross: "Modified gross",
  gross: "Gross",
  ground: "Ground",
  month_to_month: "Month-to-month",
};

const AC = 43560;
const n = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** In-place rent as an annual dollar figure, from the deal's stated basis. */
export function annualInPlaceRent(rent: unknown, basis: string | null, lotSf: unknown, buildingSf: unknown): number | null {
  const r = n(rent);
  if (r == null) return null;
  const lot = n(lotSf);
  const bsf = n(buildingSf);
  switch (basis) {
    case "total_monthly": return r * 12;
    case "per_acre_monthly": return lot ? r * (lot / AC) * 12 : null;
    case "per_sf_bldg_monthly": return bsf ? r * bsf * 12 : null;
    case "per_sf_bldg_annual": return bsf ? r * bsf : null;
    case "per_sf_land_monthly": return lot ? r * lot * 12 : null;
    default: return null;
  }
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

export function performance(input: {
  today: string;
  asset: { site_acres: number | null; building_sf: number | null; purchase_price: number | null; acquisition_costs: number | null; purchased_on: string | null; sale_price: number | null; selling_costs: number | null; sold_on: string | null; status: string; asset_class: string };
  deal: { closed_price: number | null; closed_on: string | null; in_place_rent: number | null; in_place_rent_basis: string | null; lot_sf: number | null; building_sf: number | null } | null;
  returns: { purchasePrice?: number | null; allInCost?: number | null; goingInYieldPct?: number | null; exitCapPct?: number | null; irrPct?: number | null; equityMultiple?: number | null; holdPeriodYears?: number | null; stabilizedReturnOnCostPct?: number | null } | null;
  leases: Lease[];
}) {
  const { asset, deal, returns, leases, today } = input;
  const active = leases.filter((l) => l.status === "active" && (!l.expires_on || l.expires_on >= today));
  const actualRent = active.reduce((t, l) => t + (n(l.base_rent_monthly) ?? 0) * 12, 0) || null;
  const price = n(asset.purchase_price) ?? n(deal?.closed_price) ?? n(returns?.purchasePrice);
  const basis = price != null ? price + (n(asset.acquisition_costs) ?? 0) : null;
  const ios = asset.asset_class !== "industrial";
  const leasedAcres = active.reduce((t, l) => t + (n(l.leased_acres) ?? 0), 0);
  const leasedSf = active.reduce((t, l) => t + (n(l.leased_sf) ?? 0), 0);
  const occupancy = ios
    ? asset.site_acres && leasedAcres ? Math.min(1, leasedAcres / Number(asset.site_acres)) : null
    : asset.building_sf && leasedSf ? Math.min(1, leasedSf / Number(asset.building_sf)) : null;

  // Weighted by rent: years left on each active lease.
  const rentWeighted = active.filter((l) => l.expires_on && n(l.base_rent_monthly));
  const rentTotal = rentWeighted.reduce((t, l) => t + n(l.base_rent_monthly)!, 0);
  const walt = rentTotal
    ? rentWeighted.reduce((t, l) => t + n(l.base_rent_monthly)! * Math.max(0, daysBetween(today, l.expires_on!) / 365.25), 0) / rentTotal
    : null;

  const uwRent = deal ? annualInPlaceRent(deal.in_place_rent, deal.in_place_rent_basis, deal.lot_sf, deal.building_sf) : null;
  const heldYears = asset.purchased_on ? daysBetween(asset.purchased_on, asset.sold_on ?? today) / 365.25 : null;
  const realizedMultiple =
    asset.status === "sold" && n(asset.sale_price) && basis
      ? (n(asset.sale_price)! - (n(asset.selling_costs) ?? 0)) / basis
      : null;

  return {
    price,
    basis,
    uw: {
      rent: uwRent,
      goingInYield: n(returns?.goingInYieldPct),
      stabilizedYield: n(returns?.stabilizedReturnOnCostPct),
      exitCap: n(returns?.exitCapPct),
      irr: n(returns?.irrPct),
      multiple: n(returns?.equityMultiple),
      holdYears: n(returns?.holdPeriodYears),
      allInCost: n(returns?.allInCost),
    },
    actual: {
      rent: actualRent,
      yieldOnCost: actualRent && basis ? actualRent / basis : null,
      occupancy,
      walt,
      heldYears,
      realizedMultiple,
      activeLeases: active.length,
    },
  };
}

/** Active leases expiring within `days` (or already past and still active), soonest first. */
export function expiringLeases<T extends { status: string; expires_on: string | null }>(leases: T[], today: string, days = 180): T[] {
  const horizon = new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  return leases
    .filter((l) => l.status === "active" && l.expires_on && l.expires_on <= horizon)
    .sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)));
}

/**
 * A rent-roll row's rent as dollars per month, from how the roll quotes it.
 * Null when the basis needs a size the row doesn't give.
 */
export function monthlyRent(rent: unknown, basis: string | null | undefined, sizes: { buildingSf?: unknown; acres?: unknown; lotSf?: unknown }): number | null {
  const r = n(rent);
  if (r == null) return null;
  const sf = n(sizes.buildingSf), ac = n(sizes.acres), lot = n(sizes.lotSf) ?? (ac ? ac * AC : null);
  switch (basis) {
    case "total_monthly": return r;
    case "per_sf_bldg_monthly": return sf ? r * sf : null;
    case "per_sf_bldg_annual": return sf ? (r * sf) / 12 : null;
    case "per_acre_monthly": return ac ? r * ac : lot ? r * (lot / AC) : null;
    case "per_sf_land_monthly": return lot ? r * lot : null;
    default: return null;
  }
}
