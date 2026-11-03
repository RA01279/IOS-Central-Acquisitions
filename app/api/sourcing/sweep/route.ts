// POST { submarket } | { address } | { lat, lng }, radiusMiles, profileIds -> yard sites.
// Searches Google Places for businesses that operate from outdoor yards, groups
// them into sites, and marks the ones Hopper already has (deals of any stage,
// including archived targets; owned assets; comps).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { readAllCompPages } from "@/lib/comps/mapData";
import { geocodeAddress } from "@/lib/geocode";
import { validCoordinates } from "@/lib/location";
import { findSubmarket, marketAt } from "@/lib/sourcing/markets";
import { attachParcels, buildSites, searchYardUsers, enrichBusinessContacts, matchKnownSites, type KnownPoint } from "@/lib/sourcing/sweep";
import { haversineMiles } from "@/lib/comps/match";
import { selectedProfiles } from "@/lib/sourcing/profiles";
import { lookupParcels } from "@/lib/sourcing/parcels";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return NextResponse.json({ error: "Google Maps is not configured." }, { status: 503 });
  const body = await req.json().catch(() => null);
  const profiles = selectedProfiles(body?.profileIds);
  if (!profiles) return NextResponse.json({ error: "Select at least one valid business / occupier profile." }, { status: 400 });
  const radiusMiles = Number(body?.radiusMiles);
  if (!Number.isFinite(radiusMiles) || radiusMiles < 0.5 || radiusMiles > 10) return NextResponse.json({ error: "Choose a radius from 0.5 to 10 miles." }, { status: 400 });

  let center: { lat: number; lng: number } | null = null;
  let label = "";
  if (typeof body?.submarket === "string") {
    const hit = findSubmarket(body.submarket);
    if (hit) { center = { lat: hit.submarket.lat, lng: hit.submarket.lng }; label = `${hit.market.label}: ${hit.submarket.label}`; }
  } else if (typeof body?.address === "string" && body.address.trim()) {
    const g = await geocodeAddress([body.address.trim().slice(0, 200)]);
    if (g) { center = { lat: g.lat, lng: g.lng }; label = g.formatted ?? body.address.trim(); }
  } else if (validCoordinates({ latitude: body?.lat, longitude: body?.lng })) {
    center = { lat: Number(body.lat), lng: Number(body.lng) }; label = "Dropped pin";
  }
  if (!center) return NextResponse.json({ error: "Choose a submarket, enter an address Google can find, or drop a pin." }, { status: 400 });

  const db = getServiceClient();
  let known: KnownPoint[];
  try {
    const [props, assets, comps] = await Promise.all([
      readAllCompPages<any>((from, to) => db.from("properties").select("id, address, latitude, longitude, deals(id, stage)").not("latitude", "is", null).order("id").range(from, to) as any),
      readAllCompPages<any>((from, to) => db.from("assets").select("id, address, status, latitude, longitude").not("latitude", "is", null).order("id").range(from, to) as any),
      readAllCompPages<any>((from, to) => db.from("comps").select("id, address, comp_type, latitude, longitude").not("latitude", "is", null).order("id").range(from, to) as any),
    ]);
    known = [
      ...props.flatMap((p) => (p.deals ?? []).map((d: any) => ({ kind: "deal" as const, id: d.id, stage: d.stage, address: p.address, label: `${p.address} (${d.stage})`, href: `/deals/${d.id}`, lat: Number(p.latitude), lng: Number(p.longitude) }))),
      ...assets.map((a) => ({ kind: "asset" as const, id: a.id, status: a.status, address: a.address, label: a.address, href: `/assets/${a.id}`, lat: Number(a.latitude), lng: Number(a.longitude) })),
      ...comps.map((c) => ({ kind: "comp" as const, id: c.id, address: c.address, label: `${c.address} (${c.comp_type} comp)`, href: `/comps/${c.id}`, lat: Number(c.latitude), lng: Number(c.longitude) })),
    ].filter((k) => Number.isFinite(k.lat) && Number.isFinite(k.lng));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const { places, screened, failedSearches, totalSearches, searches, coverage } = await searchYardUsers(center, radiusMiles, key, fetch, profiles);
  if (failedSearches === totalSearches) return NextResponse.json({ error: "Google Places searches failed. Retry in a minute." }, { status: 502 });
  const grouped = buildSites(center, radiusMiles, places, known);
  // Owner of record for every site (~150 ms each, 8 at a time).
  const [parcels, contacts] = await Promise.all([lookupParcels(grouped), enrichBusinessContacts(grouped, key)]);
  const merged = attachParcels(grouped, parcels);
  // Parcel comparison is bounded; missing evidence never turns proximity into identity.
  const candidates = known.filter(k => merged.some(s => haversineMiles(s.lat, s.lng, k.lat, k.lng) < .25)).slice(0, 24);
  const rolls = await lookupParcels(candidates);
  const enriched = new Map(candidates.map((k, i) => [`${k.kind}:${k.id}`, rolls[i]]));
  const sites = matchKnownSites(merged, known.map(k => ({ ...k, parcel: enriched.get(`${k.kind}:${k.id}`) })));
  const payload = {
    center, label, market: marketAt(center.lat, center.lng), radiusMiles, sites, createdAt: new Date().toISOString(),
    screened, failedSearches, totalSearches, searches, coverage, contacts, profileIds: profiles.map((p) => p.id),
    note: "Expanded Google sample with pagination and smaller searches in dense areas. Coverage is bounded, not an inventory. Nearby records and comps remain research context. Business contacts are not verified property-owner contacts.",
  };
  const saved = await db.from("sourcing_sweeps").insert({ owner_email: user.email.toLowerCase(), snapshot: payload }).select("id").single();
  if (saved.error) return NextResponse.json({ error: "Could not save the reviewed sweep. Retry before qualifying sites." }, { status: 503 });
  return NextResponse.json({ ...payload, sweepId: saved.data.id }, { headers: { "Cache-Control": "private, no-store" } });
}
