// POST { submarket } | { address } | { lat, lng }, radiusMiles -> yard sites.
// Searches Google Places for businesses that operate from outdoor yards, groups
// them into sites, and marks the ones Hopper already has (deals of any stage,
// including archived targets; owned assets; comps).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { readAllCompPages } from "@/lib/comps/mapData";
import { geocodeAddress } from "@/lib/geocode";
import { validCoordinates } from "@/lib/location";
import { findSubmarket } from "@/lib/sourcing/markets";
import { attachParcels, buildSites, searchYardUsers, type KnownPoint } from "@/lib/sourcing/sweep";
import { lookupParcels } from "@/lib/sourcing/parcels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return NextResponse.json({ error: "Google Maps is not configured." }, { status: 503 });
  const body = await req.json().catch(() => null);
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
      readAllCompPages<any>((from, to) => db.from("assets").select("id, address, latitude, longitude").not("latitude", "is", null).order("id").range(from, to) as any),
      readAllCompPages<any>((from, to) => db.from("comps").select("id, address, comp_type, latitude, longitude").not("latitude", "is", null).order("id").range(from, to) as any),
    ]);
    known = [
      ...props.flatMap((p) => (p.deals ?? []).slice(0, 1).map((d: any) => ({ kind: "deal" as const, id: d.id, label: `${p.address} (${d.stage})`, href: `/deals/${d.id}`, lat: Number(p.latitude), lng: Number(p.longitude) }))),
      ...assets.map((a) => ({ kind: "asset" as const, id: a.id, label: a.address, href: "/assets", lat: Number(a.latitude), lng: Number(a.longitude) })),
      ...comps.map((c) => ({ kind: "comp" as const, id: c.id, label: `${c.address} (${c.comp_type} comp)`, href: `/comps/${c.id}`, lat: Number(c.latitude), lng: Number(c.longitude) })),
    ].filter((k) => Number.isFinite(k.lat) && Number.isFinite(k.lng));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const { places, screened, failedSearches, totalSearches } = await searchYardUsers(center, radiusMiles, key);
  if (failedSearches === totalSearches) return NextResponse.json({ error: "Google Places searches failed. Retry in a minute." }, { status: 502 });
  const grouped = buildSites(center, radiusMiles, places, known);
  // Owner of record for every site (~150 ms each, 8 at a time).
  const sites = attachParcels(grouped, await lookupParcels(grouped));
  return NextResponse.json({
    center, label, radiusMiles, sites,
    screened, failedSearches, totalSearches,
    note: "Google returns at most 20 businesses per search term, so a sweep is a sample of the area, not an inventory. Sweep tighter radii around clusters for more.",
  });
}
