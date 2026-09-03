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
  if (incoming.length > 200) {
    return NextResponse.json({ error: "Too many comps in one save (max 200)" }, { status: 400 });
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

  const geo = await geocodeMany(valid, (c) => [c.address, c.city, c.market]);

  const supabase = getServiceClient();
  let saved = 0;
  let duplicates = 0;
  const failed: { address: string; reason: string }[] = [];

  // Inserted one at a time so a single duplicate doesn't reject the batch.
  // Re-pasting the same email is expected behaviour, not an error -- the unique
  // index on (address, type, date) is what makes it idempotent.
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    const g = geo[i];
    const acres = plain(c.acres);
    const lotSf = plain(c.lotSf) ?? (acres !== null ? Math.round(acres * SQFT_PER_ACRE) : null);

    const row: Record<string, unknown> = {
      comp_type: c.compType,
      address: c.address,
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
      source: ["manual", "excel", "email", "import"].includes(body.source) ? body.source : "manual",
      source_ref: str(body.sourceRef),
      created_by: user.email,
      status: "confirmed",
      date_precision: ["day", "month", "quarter", "year"].includes(c.datePrecision)
        ? c.datePrecision
        : "day",
      latitude: g?.lat ?? null,
      longitude: g?.lng ?? null,
      geocode_precision: g?.precision ?? null,
      geocoded_at: g ? new Date().toISOString() : null,
    };

    if (c.compType === "lease") {
      row.rent = money(c.rent);
      row.rent_basis = str(c.rentBasis);
      row.lease_type = str(c.leaseType);
      row.lease_term_months = plain(c.leaseTermMonths);
      row.tenant_name = str(c.tenantName);
      row.date_commenced = str(c.dateCommenced);
    } else {
      row.sale_price = money(c.salePrice);
      row.closed_on = str(c.closedOn);
      row.cap_rate = plain(c.capRate);
      row.buyer = str(c.buyer);
      row.seller = str(c.seller);
    }

    const { error } = await supabase.from("comps").insert(row);
    if (!error) {
      saved++;
    } else if (error.code === "23505") {
      duplicates++; // already in the repository
    } else {
      failed.push({ address: c.address, reason: error.message });
    }
  }

  const centroids = geo.filter((g) => g?.precision === "approximate").length;
  const ungeocoded = geo.filter((g) => !g).length;

  return NextResponse.json({
    saved,
    duplicates,
    rejected,
    failed,
    // Surfaced so a batch of comps that can't be distance-matched is visible
    // rather than quietly useless.
    geocoding: { centroidOnly: centroids, failed: ungeocoded },
  });
}
