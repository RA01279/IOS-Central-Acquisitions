// app/api/assets/[id]/leases/route.ts
//
// An owned asset's rent roll.
// POST   { tenant, suite?, leasedSf?, leasedAcres?, commencedOn?, expiresOn?, baseRentMonthly?, escalationPct?, leaseType?, options?, notes? }
// PATCH  { leaseId, ...any of the above, status? }
// DELETE { leaseId }
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { parseMoney } from "@/lib/money";
import { validDate } from "@/lib/stage-rules";
import { escalationFraction } from "@/lib/markets";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEASE_TYPES = ["nnn", "modified_gross", "gross", "ground", "month_to_month"];
const STATUSES = ["active", "expired", "terminated"];

function positive(v: unknown, label: string): number | null {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace(/[,\s]/g, ""));
  if (!Number.isFinite(x) || x <= 0) throw new Error(`${label} must be a positive number`);
  return x;
}
function text(v: unknown, max: number, label: string): string | null {
  const s = String(v ?? "").trim();
  if (s.length > max) throw new Error(`${label} is limited to ${max} characters`);
  return s || null;
}
function date(v: unknown, label: string): string | null {
  if (v == null || v === "") return null;
  if (!validDate(v)) throw new Error(`${label}: enter a valid date`);
  return v as string;
}

/** Request fields -> columns; only the fields present are returned. */
function columns(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("tenant" in body) {
    const t = text(body.tenant, 200, "Tenant");
    if (!t) throw new Error("Enter the tenant");
    out.tenant = t;
  }
  if ("suite" in body) out.suite = text(body.suite, 60, "Suite");
  if ("leasedSf" in body) out.leased_sf = positive(body.leasedSf, "Leased SF");
  if ("leasedAcres" in body) out.leased_acres = positive(body.leasedAcres, "Leased acres");
  if ("commencedOn" in body) out.commenced_on = date(body.commencedOn, "Commencement");
  if ("expiresOn" in body) out.expires_on = date(body.expiresOn, "Expiration");
  if ("baseRentMonthly" in body) out.base_rent_monthly = parseMoney(body.baseRentMonthly);
  if ("escalationPct" in body) {
    const e = escalationFraction(body.escalationPct);
    if (body.escalationPct !== "" && body.escalationPct != null && e == null) throw new Error("Escalation must be a percent such as 3 or 3.5%");
    out.escalation_pct = e;
  }
  if ("leaseType" in body) {
    if (body.leaseType && !LEASE_TYPES.includes(body.leaseType)) throw new Error("Unknown lease type");
    out.lease_type = body.leaseType || null;
  }
  if ("options" in body) out.options = text(body.options, 1000, "Options");
  if ("notes" in body) out.notes = text(body.notes, 2000, "Notes");
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) throw new Error("Unknown lease status");
    out.status = body.status;
  }
  if (out.commenced_on && out.expires_on && String(out.expires_on) < String(out.commenced_on)) throw new Error("Expiration is before commencement");
  return out;
}

async function guard(req: NextRequest, id: string) {
  const user = await getCurrentUser(req);
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!UUID.test(id)) return { error: NextResponse.json({ error: "Asset not found" }, { status: 404 }) };
  const { data } = await getServiceClient().from("assets").select("id").eq("id", id).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "Asset not found" }, { status: 404 }) };
  return { user };
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  let row: Record<string, unknown>;
  try {
    row = columns({ tenant: body.tenant, ...body });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  const { data, error } = await getServiceClient()
    .from("asset_leases").insert({ ...row, asset_id: id, created_by: g.user!.email }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.leaseId ?? ""))) return NextResponse.json({ error: "Missing lease" }, { status: 400 });
  let update: Record<string, unknown>;
  try {
    update = columns(body);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  update.updated_at = new Date().toISOString();
  const { data, error } = await getServiceClient().from("asset_leases").update(update).eq("id", body.leaseId).eq("asset_id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Lease not found on this asset" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await guard(req, id);
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.leaseId ?? ""))) return NextResponse.json({ error: "Missing lease" }, { status: 400 });
  const { data, error } = await getServiceClient().from("asset_leases").delete().eq("id", body.leaseId).eq("asset_id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Lease not found on this asset" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
