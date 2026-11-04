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
  if(c.portfolio) {
    if(c.compType!=='sale') return 'A portfolio must be a sale transaction';
    if(!c.portfolio.reviewAcknowledged) return 'Review the constituent properties, allocations and source discrepancies';
    if(typeof c.portfolio.name!=='string'||!c.portfolio.name.trim()) return 'Enter the portfolio transaction name';
    if(!Array.isArray(c.portfolio.properties)||!c.portfolio.properties.length||c.portfolio.properties.length>100) return 'Enter 1–100 constituent properties';
    const identities=new Set();
    for(const p of c.portfolio.properties) {
      if(typeof p.address!=='string'||!p.address.trim()) return 'Each constituent needs its extracted address';
      const identity=`${p.address.trim().toLowerCase()}|${p.buildingIdentifier?.trim().toLowerCase()||''}`;
      if(identities.has(identity)) return 'Duplicate constituent address/building identifier'; identities.add(identity);
      if(!['unknown','source_reported'].includes(p.allocationStatus))return 'Confirm the property allocation status';
      if(p.allocationStatus==='unknown'&&p.allocatedPrice!=null)return 'An unknown allocation cannot have a price';
      if(p.allocationStatus==='source_reported'&&!(typeof p.allocatedPrice==='number'&&Number.isFinite(p.allocatedPrice)&&p.allocatedPrice>0))return 'Enter a positive source-reported property allocation';
      for(const key of ['buildingSf','acres']) if(p[key]!=null&&!(typeof p[key]==='number'&&Number.isFinite(p[key])&&p[key]>=0))return 'Property metrics must be nonnegative or unknown';
      for(const key of ['sourcePage','sourceRow'])if(p[key]!=null&&!(Number.isInteger(p[key])&&p[key]>0))return 'Source page and row must be positive integers or unknown';
    }
  }
  for (const key of ["buildingSf", "lotSf", "acres", "yardAcres", "officeSf", "leaseTermMonths"]) {
    if (c[key] != null && (typeof c[key] !== "number" || !Number.isFinite(c[key]) || c[key] < 0)) return `${key}: enter a nonnegative number`;
  }
  return null;
}
