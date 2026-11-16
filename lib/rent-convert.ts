// lib/rent-convert.ts
//
// Usable-land rent conversions for the sidebar Rent calculator
// (components/RentCalculator.tsx): $ per usable acre per month <-> $ per SF of
// usable land per month. Per-SF to 8 decimal places, per-acre to the cent.

export const SF_PER_ACRE = 43560;

/** "$7,500" / "7500.5" / " 0.17 " -> a non-negative number; null when it isn't one. */
export function parseRate(input: string): number | null {
  const t = input.replace(/[$,\s]/g, "");
  if (!t || !/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** $/acre/month -> $/SF/month, as a string to 8 decimal places. */
export function perAcreToPerSf(perAcre: number): string {
  return (perAcre / SF_PER_ACRE).toFixed(8);
}

/** $/SF/month -> $/acre/month, as a string to the cent, with thousands separators. */
export function perSfToPerAcre(perSf: number): string {
  return (perSf * SF_PER_ACRE).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Dollars to the cent with thousands separators: 35000 -> "$35,000.00". */
export function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A site's rent from its rate per usable acre per month and its usable acres:
 * monthly and annual totals, usable SF, and $/SF/year to 8 decimals. Null
 * until both numbers are there.
 */
export function siteRent(perAcre: number | null, acres: number | null) {
  if (perAcre == null || acres == null || acres <= 0) return null;
  const monthly = perAcre * acres;
  return { monthly, annual: monthly * 12, usableSf: acres * SF_PER_ACRE, perSfAnnual: ((perAcre * 12) / SF_PER_ACRE).toFixed(8) };
}
