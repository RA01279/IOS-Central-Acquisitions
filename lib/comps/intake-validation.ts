import { validDate } from "../stage-rules";
export const RENT_BASES = ["per_acre_monthly", "per_sf_land_monthly", "per_sf_bldg_monthly", "per_sf_bldg_annual", "total_monthly"];
export function compIssue(c: Record<string, any>): string | null {
  if (typeof c.address !== "string" || !c.address.trim()) return "Needs a street address";
  if (!["lease", "sale"].includes(c.compType)) return "Choose Lease or Sale";
  if (!["ios", "industrial"].includes(c.assetClass)) return "Choose IOS or Industrial";
  const amount = c.compType === "lease" ? c.rent : c.salePrice;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return c.compType === "lease" ? "Enter a positive rent" : "Enter a positive sale price";
  if (c.compType === "lease" && !RENT_BASES.includes(c.rentBasis)) return "Choose the rent units";
  if (!validDate(c.compType === "lease" ? c.dateCommenced : c.closedOn)) return c.compType === "lease" ? "Enter a valid commencement date" : "Enter a valid closing date";
  for (const key of ["buildingSf", "lotSf", "acres", "yardAcres", "officeSf", "leaseTermMonths"]) {
    if (c[key] != null && (typeof c[key] !== "number" || !Number.isFinite(c[key]) || c[key] < 0)) return `${key}: enter a nonnegative number`;
  }
  return null;
}
