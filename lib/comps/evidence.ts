// lib/comps/evidence.ts
//
// SERVER ONLY. The comp evidence every market figure is computed from, and the
// subject it's compared against. One loader and one subject, so the comps
// panel, the rent and basis flags and the IC deck can't disagree because one
// of them read different rows or measured the property differently.

import { getServiceClient } from "@/lib/supabase";
import { readAllCompPages } from "./mapData";
import type { CompRecord, Subject } from "./match";

export const COMP_EVIDENCE_COLUMNS =
  "id, comp_type, address, project_name, suite, city, market, submarket, asset_class, latitude, longitude, building_sf, lot_sf, yard_acres, coverage_pct, year_built, clear_height_ft, rent, rent_basis, lease_type, cam_psf_annual, date_commenced, date_estimated, sale_price, closed_on, cap_rate, tenant_name, buyer, geocode_precision, lease_term_months, free_rent_months, escalations_pct";

/**
 * Confirmed, located comps -- a draft or an ungeocoded comp has no business
 * influencing an underwriting assumption. The whole repository rather than one
 * market: the radius is the real constraint, and market labels are too
 * inconsistent to trust. Paged, because a row cap would drop comps silently.
 */
export async function loadCompEvidence(): Promise<CompRecord[]> {
  const db = getServiceClient();
  return readAllCompPages<CompRecord>((from, to) =>
    db
      .from("comps")
      .select(COMP_EVIDENCE_COLUMNS)
      .eq("status", "confirmed")
      .not("latitude", "is", null)
      .order("id")
      .range(from, to) as any
  );
}

/** A deal (with its property) as the matcher's subject. */
export function subjectOf(deal: any): Subject {
  const p = (Array.isArray(deal.properties) ? deal.properties[0] : deal.properties) ?? {};
  const buildingSf = p.building_sf != null ? Number(p.building_sf) : null;
  const lotSf = p.lot_sf != null ? Number(p.lot_sf) : null;
  return {
    lat: p.latitude != null ? Number(p.latitude) : null,
    lng: p.longitude != null ? Number(p.longitude) : null,
    buildingSf,
    lotSf,
    // A FRACTION, like comps.coverage_pct. Coverage isn't stored on a property
    // but it's derivable, and it's the factor that separates a yard from a
    // warehouse.
    coveragePct: buildingSf && lotSf ? buildingSf / lotSf : null,
    assetClass: deal.asset_class ?? null,
    market: p.market ?? null,
    submarket: p.submarket ?? null,
  };
}
