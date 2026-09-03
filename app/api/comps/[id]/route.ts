// app/api/comps/[id]/route.ts
// Edit or remove a single comp.
//
// Only fields present in the body are written, so a form that submits a subset
// can't blank out everything it didn't render -- which matters because the
// editor shows different fields for lease and sale comps.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { geocodeAddress } from "@/lib/geocode";

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
function int(v: unknown): number | null {
  const n = plain(v);
  return n === null ? null : Math.round(n);
}
function str(v: unknown): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
}
function bool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
}
/** Percent typed as 6.5 meaning 6.5%, or 0.065 already a fraction. */
function fraction(v: unknown): number | null {
  const n = plain(v);
  if (n === null) return null;
  return Number((n > 1 ? n / 100 : n).toFixed(6));
}
function enumOf(v: unknown, allowed: string[]): string | null {
  const s = str(v);
  return s && allowed.includes(s) ? s : null;
}

// field name in the request -> column name + coercion. Anything not listed
// here is ignored, so the route can't be used to write arbitrary columns.
const FIELDS: Record<string, { column: string; coerce: (v: unknown) => unknown }> = {
  address: { column: "address", coerce: str },
  projectName: { column: "project_name", coerce: str },
  suite: { column: "suite", coerce: str },
  city: { column: "city", coerce: str },
  state: {
    column: "state",
    coerce: (v) => {
      const s = str(v);
      return s && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
    },
  },
  market: { column: "market", coerce: str },
  submarket: { column: "submarket", coerce: str },
  assetClass: { column: "asset_class", coerce: (v) => enumOf(v, ["ios", "industrial"]) },
  notes: { column: "notes", coerce: str },
  status: { column: "status", coerce: (v) => enumOf(v, ["draft", "confirmed", "rejected"]) },

  buildingSf: { column: "building_sf", coerce: plain },
  lotSf: { column: "lot_sf", coerce: plain },
  coveragePct: { column: "coverage_pct", coerce: fraction },
  yearBuilt: { column: "year_built", coerce: int },
  clearHeightFt: { column: "clear_height_ft", coerce: plain },
  officeSf: { column: "office_sf", coerce: plain },
  dockHighDoors: { column: "dock_high_doors", coerce: int },
  gradeLevelDoors: { column: "grade_level_doors", coerce: int },
  powerAmps: { column: "power_amps", coerce: int },
  occupancyStatus: { column: "occupancy_status", coerce: (v) => enumOf(v, ["vacant", "occupied"]) },
  tenancy: { column: "tenancy", coerce: (v) => enumOf(v, ["single_tenant", "multi_tenant"]) },

  yardAcres: { column: "yard_acres", coerce: plain },
  surfaceType: {
    column: "surface_type",
    coerce: (v) =>
      enumOf(v, ["concrete", "asphalt", "crushed_stone", "gravel", "dirt", "mixed", "unimproved"]),
  },
  fenced: { column: "fenced", coerce: bool },
  trailerStalls: { column: "trailer_stalls", coerce: int },
  zoning: { column: "zoning", coerce: str },
  outdoorStoragePermitted: { column: "outdoor_storage_permitted", coerce: bool },

  rent: { column: "rent", coerce: money },
  rentBasis: {
    column: "rent_basis",
    coerce: (v) =>
      enumOf(v, [
        "per_acre_monthly",
        "per_sf_land_monthly",
        "per_sf_bldg_monthly",
        "per_sf_bldg_annual",
        "total_monthly",
      ]),
  },
  leaseType: {
    column: "lease_type",
    coerce: (v) =>
      enumOf(v, ["nnn", "gross", "modified_gross", "industrial_gross", "absolute_net", "other"]),
  },
  camPsfAnnual: { column: "cam_psf_annual", coerce: plain },
  dateCommenced: { column: "date_commenced", coerce: str },
  leaseExpiresOn: { column: "lease_expires_on", coerce: str },
  leaseTermMonths: { column: "lease_term_months", coerce: int },
  tenantName: { column: "tenant_name", coerce: str },
  landlordName: { column: "landlord_name", coerce: str },
  escalationsPct: { column: "escalations_pct", coerce: plain },
  freeRentMonths: { column: "free_rent_months", coerce: plain },
  tiPsf: { column: "ti_psf", coerce: plain },
  renewalOptions: { column: "renewal_options", coerce: str },
  listingBroker: { column: "listing_broker", coerce: str },
  tenantRepBroker: { column: "tenant_rep_broker", coerce: str },

  salePrice: { column: "sale_price", coerce: money },
  closedOn: { column: "closed_on", coerce: str },
  capRate: { column: "cap_rate", coerce: fraction },
  noi: { column: "noi", coerce: money },
  buyer: { column: "buyer", coerce: str },
  seller: { column: "seller", coerce: str },
  saleBroker: { column: "sale_broker", coerce: str },
  occupancyAtSale: { column: "occupancy_at_sale", coerce: fraction },
  datePrecision: {
    column: "date_precision",
    coerce: (v) => enumOf(v, ["day", "month", "quarter", "year"]) ?? "day",
  },
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: existing, error: findErr } = await supabase
    .from("comps")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Comp not found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(FIELDS)) {
    if (key in body) update[spec.column] = spec.coerce(body[key]);
  }

  // A commencement date typed by a human is a stated date, not an inference
  // any more -- so editing it clears the estimate flag and the coarse
  // precision that came with it. Leaving the flag set would keep discounting a
  // date that is now as good as any other.
  if (
    existing.date_estimated &&
    "dateCommenced" in body &&
    update.date_commenced &&
    update.date_commenced !== existing.date_commenced
  ) {
    update.date_estimated = false;
    if (!("datePrecision" in body)) update.date_precision = "day";
  }

  // Acres is the unit people type; lot_sf is what's stored.
  if ("acres" in body && !("lotSf" in body)) {
    const acres = plain(body.acres);
    update.lot_sf = acres === null ? null : Math.round(acres * SQFT_PER_ACRE);
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "No editable fields in the request" }, { status: 400 });
  }

  const merged = { ...existing, ...update };

  // Same per-type rules the DB enforces, checked here so the message is
  // readable rather than a Postgres constraint name.
  if (merged.comp_type === "lease") {
    if (!merged.rent) return NextResponse.json({ error: "A lease comp needs a rent" }, { status: 400 });
    if (!merged.rent_basis) return NextResponse.json({ error: "A lease comp needs a rent basis" }, { status: 400 });
    if (!merged.date_commenced) {
      return NextResponse.json({ error: "A lease comp needs a commencement date" }, { status: 400 });
    }
  } else {
    if (!merged.sale_price) return NextResponse.json({ error: "A sale comp needs a price" }, { status: 400 });
    if (!merged.closed_on) return NextResponse.json({ error: "A sale comp needs a close date" }, { status: 400 });
  }

  // A corrected address is usually the whole point of editing one -- re-resolve
  // it rather than leaving the old coordinates pointing somewhere else.
  const addressChanged =
    ("address" in body && update.address !== existing.address) ||
    ("city" in body && update.city !== existing.city) ||
    // Correcting the STATE is the whole point of storing it: a comp geocoded
    // into the wrong state is fixed by fixing the state, which has to re-run
    // the lookup or the coordinates stay where they were.
    ("state" in body && update.state !== existing.state) ||
    ("market" in body && update.market !== existing.market);
  if (addressChanged && merged.address) {
    const g = await geocodeAddress(
      [merged.address as string, merged.city as string, merged.market as string],
      { state: merged.state as string | null }
    );
    update.latitude = g?.lat ?? null;
    update.longitude = g?.lng ?? null;
    update.geocode_precision = g?.precision ?? null;
    update.geocoded_at = g ? new Date().toISOString() : null;
  }

  update.updated_at = new Date().toISOString();
  update.updated_by = user.email;

  const { data, error } = await supabase
    .from("comps")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Another comp already has this address, type and date." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ comp: data, regeocoded: addressChanged });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getServiceClient();
  const { error } = await supabase.from("comps").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
