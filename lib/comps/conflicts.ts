/** Mirrors the persisted transaction key; economics are deliberately not identity. */
export function sameStoredTransaction(a: Record<string, any>, b: Record<string, any>): boolean {
  const lower = (v: unknown) => String(v ?? "").toLowerCase();
  return lower(a.address) === lower(b.address) && a.comp_type === b.comp_type &&
    (a.date_commenced ?? a.closed_on) === (b.date_commenced ?? b.closed_on) &&
    lower(a.project_name) === lower(b.project_name) && lower(a.suite) === lower(b.suite);
}
const NUMERIC = new Set(["rent", "sale_price", "building_sf", "lot_sf", "yard_acres", "cap_rate", "noi", "free_rent_months", "lease_term_months", "escalations_pct", "ti_psf", "cam_psf_annual"]);
/** New evidence must be reviewed against stored corrections, never silently dropped. */
export function conflictingEvidence(incoming: Record<string, any>, saved: Record<string, any>): string[] {
  return ["rent", "rent_basis", "sale_price", "building_sf", "lot_sf", "yard_acres", "lease_type", "tenant_name", "buyer", "cap_rate", "noi", "free_rent_months", "lease_term_months", "escalations_pct", "ti_psf", "cam_psf_annual"].filter(key => {
    const a=incoming[key],b=saved[key];
    if(a == null || a === "") return false; // absence does not erase supported history
    if(b == null || b === "") return true;
    return NUMERIC.has(key) ? Math.abs(Number(a)-Number(b)) > 1e-8 : String(a).trim().toLowerCase() !== String(b).trim().toLowerCase();
  });
}
