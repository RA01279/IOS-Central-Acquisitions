// app/api/comps/route.ts
// The comp repository: list, and save reviewed comps.
//
// Saving geocodes each address so comps can be distance-scored against a
// subject property. A comp that won't geocode is still saved -- it just can't
// take part in distance matching, which is better than refusing the data.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { geocodeMany } from "@/lib/geocode";

export const dynamic = "force-dynamic";

const SQFT_PER_ACRE = 43560;

function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s±]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function plain(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,\s±%]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
}

// GET /api/comps?type=lease|sale&market=&status=&limit=
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const supabase = getServiceClient();
  let query = supabase
    .from("comps")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Number(p.get("limit") ?? 200), 500));

  if (p.get("type")) query = query.eq("comp_type", p.get("type"));
  if (p.get("market")) query = query.eq("market", p.get("market"));
  if (p.get("status")) query = query.eq("status", p.get("status"));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comps: data ?? [] });
}

// POST /api/comps  { comps: [...], source?, sourceRef? }
// Each comp is the reviewed shape from the UI -- already corrected by a human,
// so it saves as 'confirmed'.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.comps) ? body.comps : null;
  if (!incoming?.length) {
    return NextResponse.json({ error: "No comps supplied" }, { status: 400 });
  }
  // The standard TX IOS comp table is 282 rows in one tab, so a 200 cap
  // rejected the canonical file outright. 600 is headroom over that without
  // inviting someone to drop a 20,000-row lookup sheet.
  if (incoming.length > 600) {
    return NextResponse.json(
      { error: `Too many comps in one save (${incoming.length}; max 600). Split the file.` },
      { status: 400 }
    );
  }

  // Validate before spending money on geocoding. These mirror the DB's
  // per-type CHECK constraint so the failure is a readable message rather than
  // a Postgres error.
  const rejected: { address: string; reason: string }[] = [];
  const valid: any[] = [];
  for (const c of incoming) {
    const address = str(c.address);
    if (!address) {
      rejected.push({ address: "(blank)", reason: "No address" });
      continue;
    }
    const compType = c.compType === "sale" ? "sale" : "lease";
    if (compType === "lease") {
      if (money(c.rent) === null) {
        rejected.push({ address, reason: "Lease comp needs a rent" });
        continue;
      }
      if (!str(c.rentBasis)) {
        rejected.push({ address, reason: "Lease comp needs a rent basis" });
        continue;
      }
      if (!str(c.dateCommenced)) {
        rejected.push({ address, reason: "Lease comp needs a commencement date" });
        continue;
      }
    } else {
      if (money(c.salePrice) === null) {
        rejected.push({ address, reason: "Sale comp needs a price" });
        continue;
      }
      if (!str(c.closedOn)) {
        rejected.push({ address, reason: "Sale comp needs a close date" });
        continue;
      }
    }
    valid.push({ ...c, address, compType });
  }

  if (!valid.length) {
    return NextResponse.json({ saved: 0, duplicates: 0, rejected }, { status: 400 });
  }

  // Coordinates the source file already carried are used as-is. The standard
  // TX IOS template has them on all 282 rows -- geocoded once by the team, at
  // the yard rather than at the street centroid -- so sending those addresses
  // to Google would spend money to get a worse answer. Only rows without them
  // are resolved.
  const preset = valid.map((c) => {
    const lat = Number(c.latitude);
    const lng = Number(c.longitude);
    const ok =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return ok ? { lat, lng } : null;
  });
  const needGeo = valid.filter((_, i) => !preset[i]);
  const resolved = await geocodeMany(needGeo, (c) => [c.address, c.city, c.market]);
  let nextResolved = 0;
  const geo = valid.map((_, i) =>
    preset[i]
      ? { lat: preset[i]!.lat, lng: preset[i]!.lng, precision: "supplied" as const }
      : resolved[nextResolved++]
  );

  const supabase = getServiceClient();
  let saved = 0;
  let duplicates = 0;
  const failed: { address: string; reason: string }[] = [];

  const rows: { address: string; row: Record<string, unknown> }[] = [];
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    const g = geo[i];
    const acres = plain(c.acres);
    const lotSf = plain(c.lotSf) ?? (acres !== null ? Math.round(acres * SQFT_PER_ACRE) : null);

    const row: Record<string, unknown> = {
      comp_type: c.compType,
      address: c.address,
      // Two buildings in one business park share a street address; the project
      // name is what keeps them from colliding in the dedupe index.
      project_name: str(c.projectName),
      // And a suite is what keeps nine tenancies inside one building from
      // colliding, which is exactly what a rent roll delivers.
      suite: str(c.suite),
      city: str(c.city),
      market: str(c.market),
      submarket: str(c.submarket),
      asset_class: c.assetClass === "industrial" ? "industrial" : c.assetClass === "ios" ? "ios" : null,
      building_sf: plain(c.buildingSf),
      lot_sf: lotSf,
      coverage_pct: plain(c.coveragePct),
      year_built: plain(c.yearBuilt),
      occupancy_status: ["vacant", "occupied"].includes(c.occupancyStatus) ? c.occupancyStatus : null,
      tenancy: ["single_tenant", "multi_tenant"].includes(c.tenancy) ? c.tenancy : null,
      notes: str(c.notes),
      // Site detail, which the parser fills in when the broker's table has it
      // and the review step or the editor fills in when it doesn't.
      clear_height_ft: plain(c.clearHeightFt),
      office_sf: plain(c.officeSf),
      yard_acres: plain(c.yardAcres),
      trailer_stalls: plain(c.trailerStalls),
      dock_high_doors: plain(c.dockHighDoors),
      grade_level_doors: plain(c.gradeLevelDoors),
      power_amps: plain(c.powerAmps),
      surface_type: [
        "concrete", "asphalt", "crushed_stone", "gravel", "dirt", "mixed", "unimproved",
      ].includes(c.surfaceType)
        ? c.surfaceType
        : null,
      fenced: typeof c.fenced === "boolean" ? c.fenced : null,
      zoning: str(c.zoning),
      outdoor_storage_permitted:
        typeof c.outdoorStoragePermitted === "boolean" ? c.outdoorStoragePermitted : null,
      // From the standard IOS comp template. Each of these changes how much a
      // comp is worth as evidence rather than just describing the site.
      region: str(c.region),
      tenant_usage: str(c.tenantUsage),
      institutional_landlord:
        typeof c.institutionalLandlord === "boolean" ? c.institutionalLandlord : null,
      deal_kind: ["new", "renewal", "expansion", "sublease"].includes(c.dealKind)
        ? c.dealKind
        : null,
      parking_spaces: (() => {
        const n = plain(c.parkingSpaces);
        return n === null ? null : Math.max(0, Math.round(n));
      })(),
      rate_per_stall: money(c.ratePerStall),
      source: ["manual", "excel", "email", "import"].includes(body.source) ? body.source : "manual",
      // The row's own provenance beats the file's. The IOS template carries a
      // per-row Source ("CBRE MLA - TX IOS Portfolio Lease Comps 07.02.26",
      // "NAI: Josh Carl 7/8/2026"), which is far more use for chasing a number
      // back to its origin than the filename it arrived in.
      source_ref: str(c.sourceRef) ?? str(body.sourceRef),
      created_by: user.email,
      status: "confirmed",
      date_precision: ["day", "month", "quarter", "year"].includes(c.datePrecision)
        ? c.datePrecision
        : "day",
      // A commencement backed into from an expiration date is a guess, and
      // recency is the heaviest factor in scoring -- so the guess has to stay
      // labelled all the way to the database.
      date_estimated: c.dateEstimated === true,
      latitude: g?.lat ?? null,
      longitude: g?.lng ?? null,
      geocode_precision: g?.precision ?? null,
      geocoded_at: g ? new Date().toISOString() : null,
    };

    if (c.compType === "lease") {
      row.rent = money(c.rent);
      row.rent_basis = str(c.rentBasis);
      // Base rent alone makes a rent-roll comp look cheap next to a broker's
      // gross quote. Keeping CAM makes the two comparable.
      row.cam_psf_annual = plain(c.camPsfAnnual);
      row.lease_type = str(c.leaseType);
      row.lease_term_months = plain(c.leaseTermMonths);
      row.tenant_name = str(c.tenantName);
      row.landlord_name = str(c.landlordName);
      row.date_commenced = str(c.dateCommenced);
      row.lease_expires_on = str(c.leaseExpiresOn);
      row.escalations_pct = plain(c.escalationsPct);
      row.free_rent_months = plain(c.freeRentMonths);
      row.ti_psf = plain(c.tiPsf);
      row.renewal_options = str(c.renewalOptions);
      row.listing_broker = str(c.listingBroker);
      row.tenant_rep_broker = str(c.tenantRepBroker);
    } else {
      row.sale_price = money(c.salePrice);
      row.closed_on = str(c.closedOn);
      row.cap_rate = plain(c.capRate);
      row.noi = money(c.noi);
      row.buyer = str(c.buyer);
      row.seller = str(c.seller);
      row.sale_broker = str(c.saleBroker);
      row.occupancy_at_sale = plain(c.occupancyAtSale);
    }

    rows.push({ address: c.address, row });
  }

  // Written in chunks, falling back to one-at-a-time only for a chunk that
  // hits something.
  //
  // Re-dropping the same file is expected behaviour rather than an error -- the
  // unique index is what makes the import idempotent -- and a single insert per
  // row is what keeps one duplicate from rejecting the batch. But the standard
  // IOS comp table is 282 rows, and 282 sequential round trips is slow enough
  // to threaten the function timeout. So: try the chunk whole, and if anything
  // in it conflicts, replay that chunk row by row to find out exactly which
  // rows they were. Clean imports pay for one round trip per 50 rows; repeat
  // imports pay the old cost only on the chunks that actually collide.
  const CHUNK = 50;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const { error } = await supabase.from("comps").insert(chunk.map((r) => r.row));
    if (!error) {
      saved += chunk.length;
      continue;
    }
    for (const { address, row } of chunk) {
      const { error: rowErr } = await supabase.from("comps").insert(row);
      if (!rowErr) saved++;
      else if (rowErr.code === "23505") duplicates++; // already in the repository
      else failed.push({ address, reason: rowErr.message });
    }
  }

  const centroids = geo.filter((g) => g?.precision === "approximate").length;
  const ungeocoded = geo.filter((g) => !g).length;
  const supplied = geo.filter((g) => g?.precision === "supplied").length;

  return NextResponse.json({
    saved,
    duplicates,
    rejected,
    failed,
    // Surfaced so a batch of comps that can't be distance-matched is visible
    // rather than quietly useless.
    geocoding: { centroidOnly: centroids, failed: ungeocoded, fromFile: supplied },
  });
}
