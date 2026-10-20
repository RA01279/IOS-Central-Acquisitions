// lib/uw-comps.ts
//
// Confirmed comps in the shape the underwriting engine's comp adapter reads
// (lib/uw/comp-adapter CompRow) -- every confirmed comp, located or not,
// because the screen selects by market rather than radius. Cached under the
// comps tag like the evidence read, with the same fallback outside Next.

import { unstable_cache } from "next/cache";
import { getServiceClient } from "./supabase";
import { COMPS_TAG, COMPS_TTL_SECONDS } from "./comps/cache";
import { readAllCompPages } from "./comps/mapData";
import type { CompRow } from "./uw/comp-adapter";

const COLUMNS =
  "id, comp_type, address, project_name, suite, market, submarket, status, source_ref, lot_sf, building_sf, rent, rent_basis, lease_type, cam_psf_annual, escalations_pct, date_commenced, sale_price, closed_on, cap_rate, noi";

async function readFresh(): Promise<CompRow[]> {
  const db = getServiceClient();
  return readAllCompPages<CompRow>((from, to) =>
    db.from("comps").select(COLUMNS).eq("status", "confirmed").order("id").range(from, to) as any
  );
}

const readCached = unstable_cache(readFresh, ["uw-comps", COLUMNS], { tags: [COMPS_TAG], revalidate: COMPS_TTL_SECONDS });

export async function loadUwComps(): Promise<CompRow[]> {
  try {
    return await readCached();
  } catch (err: any) {
    if (/incrementalCache missing/i.test(String(err?.message))) return readFresh();
    throw err;
  }
}
