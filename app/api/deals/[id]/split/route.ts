// app/api/deals/[id]/split/route.ts
//
// POST { name, sites: [{ address, city?, latitude, longitude, geocodePrecision?, acres?, buildingSf? }] }
//
// Turns a deal entered as several sites into a portfolio: one deal per site.
// The deal itself becomes the first site -- it keeps its stage, offers, model
// versions, documents and history -- and every other site is created as a new
// deal in the same pipeline, with the same owner and broker links. Locations
// must already be verified (the form checks each with Google first).
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { createDeal, logDealEvent } from "@/lib/deals";
import { validCoordinates } from "@/lib/location";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRECISIONS = ["rooftop", "range_interpolated", "geometric_center", "manual"];
const positive = (v: unknown) => (v == null || v === "" ? null : Number(v) > 0 ? Number(v) : NaN);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Name the portfolio" }, { status: 400 });
  const sites: any[] = Array.isArray(body.sites) ? body.sites.slice(0, 100) : [];
  if (sites.length < 2) return NextResponse.json({ error: "A portfolio needs at least two sites" }, { status: 400 });
  for (const s of sites) {
    if (!String(s.address ?? "").trim()) return NextResponse.json({ error: "Every site needs an address" }, { status: 400 });
    if (!validCoordinates(s)) return NextResponse.json({ error: `Check ${s.address} with Google before splitting` }, { status: 400 });
    if ([positive(s.acres), positive(s.buildingSf)].some((x) => Number.isNaN(x))) return NextResponse.json({ error: `${s.address}: sizes must be positive numbers` }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: deal } = await db
    .from("deals")
    .select("id, ref, stage, asset_class, assigned_analyst, deal_portfolio_id, property_id, properties(id, address, city, market, submarket, asset_type)")
    .eq("id", id)
    .maybeSingle();
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.deal_portfolio_id) return NextResponse.json({ error: "This deal is already part of a portfolio" }, { status: 400 });
  const p: any = deal.properties ?? {};
  const original = String(p.address ?? "");

  const { data: pf, error: pfError } = await db
    .from("deal_portfolios")
    .insert({ name, created_by: user.email, notes: [`Split from D-${deal.ref} (${original}) by ${user.email}`] })
    .select("id")
    .single();
  if (pfError) return NextResponse.json({ error: pfError.message }, { status: 500 });

  // 1. The deal itself becomes the first site.
  const first = sites[0];
  const propUpdate: Record<string, unknown> = {
    address: String(first.address).trim(),
    city: String(first.city ?? "").trim() || p.city || null,
    latitude: Number(first.latitude),
    longitude: Number(first.longitude),
    geocode_precision: PRECISIONS.includes(first.geocodePrecision) ? first.geocodePrecision : "manual",
    geocoded_at: new Date().toISOString(),
  };
  if (positive(first.acres)) propUpdate.lot_sf = Math.round(Number(first.acres) * 43560);
  if (positive(first.buildingSf)) propUpdate.building_sf = Number(first.buildingSf);
  const { error: propError } = await db.from("properties").update(propUpdate).eq("id", deal.property_id);
  if (propError) {
    await db.from("deal_portfolios").delete().eq("id", pf.id);
    return NextResponse.json({ error: `Updating the deal's address: ${propError.message}` }, { status: 500 });
  }
  await db.from("deals").update({ deal_portfolio_id: pf.id }).eq("id", id);

  // 2. Every other site as a new deal in the package.
  const { data: links } = await db.from("deal_contacts").select("contact_id, role").eq("deal_id", id);
  const created: { id: string; address: string }[] = [];
  const skipped: { address: string; reason: string }[] = [];
  for (const s of sites.slice(1)) {
    try {
      const result: any = await createDeal({
        address: String(s.address).trim(),
        city: String(s.city ?? "").trim() || p.city || undefined,
        market: p.market ?? undefined,
        submarket: p.submarket ?? undefined,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
        geocodePrecision: s.geocodePrecision,
        assetType: ["ios", "industrial", "flex", "other"].includes(p.asset_type) ? p.asset_type : deal.asset_class,
        assetClass: deal.asset_class,
        acres: positive(s.acres) ?? undefined,
        buildingSf: positive(s.buildingSf) ?? undefined,
        createdBy: user.email,
      } as any);
      const newId = result.deal?.id;
      if (!newId) { skipped.push({ address: s.address, reason: result.duplicates?.length ? "already a deal at this address" : "not created" }); continue; }
      await db.from("deals").update({ deal_portfolio_id: pf.id, assigned_analyst: deal.assigned_analyst }).eq("id", newId);
      if (links?.length) await db.from("deal_contacts").insert(links.map((l: any) => ({ deal_id: newId, contact_id: l.contact_id, role: l.role })));
      await logDealEvent(newId, "split_from_deal", { from: deal.id, from_ref: deal.ref, portfolio: name }, user.email);
      created.push({ id: newId, address: s.address });
    } catch (err: any) {
      skipped.push({ address: s.address, reason: err.message });
    }
  }
  await logDealEvent(id, "split_into_portfolio", { portfolio: name, was: original, sites: sites.length, created: created.length, skipped: skipped.length }, user.email);
  return NextResponse.json({ ok: true, portfolioId: pf.id, created, skipped });
}
