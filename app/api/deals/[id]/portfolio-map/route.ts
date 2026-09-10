// app/api/deals/[id]/portfolio-map/route.ts
//
// The target property against our portfolio, as a basemap plus the geometry
// and rows needed to draw on it.
//
// Returns a PLAIN basemap and lets the caller place its own pins, the same way
// the demand map does. Static Maps will draw `markers=` for you, but only in a
// handful of preset colours with single-character labels, and forty assets plus
// pipeline deals plus comps would run the URL past its 8k limit. Drawing them
// in the slide also means the same pins can be styled identically on screen.
//
// The Google key is read here and never leaves the server.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { haversineMiles, zoomForRadiusMiles, LOCATED_PRECISIONS } from "@/lib/ic-deck/geo";

export const dynamic = "force-dynamic";

const GOOGLE_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const MAP_LOGICAL_SIZE = 640; // the API's hard cap; asking for more is clamped
const MAP_SCALE = 2;

/** Precisions we're willing to measure a distance from. */
const LOCATED = new Set(LOCATED_PRECISIONS);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const includeImage = req.nextUrl.searchParams.get("image") !== "0";
  if (includeImage && !GOOGLE_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_SERVER_KEY isn't configured, so the basemap can't be fetched." },
      { status: 500 }
    );
  }

  const p = req.nextUrl.searchParams;
  const radiusMiles = Number(p.get("radius") ?? 25);
  if (!Number.isFinite(radiusMiles) || radiusMiles < 0 || radiusMiles > 300 || (includeImage && radiusMiles === 0)) {
    return NextResponse.json({ error: "Choose a radius between 1 and 300 miles for a slide; CSV also supports 0 (all distances)." }, { status: 400 });
  }
  const maptype = p.get("maptype") === "satellite" ? "satellite" : "roadmap";
  const includeSold = p.get("sold") === "1";
  const layers = new Set((p.get("layers") ?? "assets").split(",").filter(Boolean));

  const supabase = getServiceClient();

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("id, stage, asset_class, properties(address, city, market, submarket, latitude, longitude, building_sf, lot_sf)")
    .eq("id", params.id)
    .maybeSingle();
  if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const prop: any = Array.isArray(deal.properties) ? deal.properties[0] : deal.properties;
  const lat = prop?.latitude != null ? Number(prop.latitude) : null;
  const lng = prop?.longitude != null ? Number(prop.longitude) : null;
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
    return NextResponse.json(
      { error: "This deal's property has no coordinates, so nothing can be measured against it." },
      { status: 400 }
    );
  }

  const results = await Promise.all([
    supabase
      .from("assets")
      .select("id, address, city, state, market, status, occupancy, site_acres, building_sf, latitude, longitude, geocode_precision")
      .neq("status", "under_contract")
      .in("geocode_precision", LOCATED_PRECISIONS)
      .not("latitude", "is", null)
      .limit(1000),
    layers.has("lease") || layers.has("sale")
      ? supabase
          .from("comps")
          .select("id, comp_type, address, city, market, rent, rent_basis, sale_price, building_sf, lot_sf, yard_acres, date_commenced, closed_on, tenant_name, latitude, longitude, geocode_precision")
          .eq("status", "confirmed")
          .not("latitude", "is", null)
          .limit(1000)
      : Promise.resolve({ data: [] as any[], error: null }),
    layers.has("pipeline")
      ? supabase
          .from("deals")
          .select("id, stage, asset_class, properties!inner(address, city, market, latitude, longitude)")
          .neq("id", params.id)
          // Archiving is a STAGE here, not a timestamp -- same filter the
          // pipeline page uses. An archived deal is not current context.
          .neq("stage", "archived")
          .neq("stage", "closed")
          .not("properties.latitude", "is", null)
          .limit(1000)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const queryError = results.find((result) => result.error)?.error;
  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 });
  const [{ data: assetRows }, { data: compRows }, { data: dealRows }] = results;
  if (results.some((result) => (result.data?.length ?? 0) >= 1000)) {
    return NextResponse.json({ error: "A map dataset reached the 1,000-record retrieval limit. Export is paused to avoid reporting incomplete distances; paginated retrieval is needed." }, { status: 422 });
  }

  const within = (a: any) => {
    if (a.latitude == null || a.longitude == null) return null;
    if (a.geocode_precision !== undefined && !LOCATED.has(a.geocode_precision ?? "")) return null;
    const d = haversineMiles(lat, lng, Number(a.latitude), Number(a.longitude));
    return Number.isFinite(d) && (radiusMiles === 0 || d <= radiusMiles) ? d : null;
  };

  const assets = (assetRows ?? [])
    .filter((a: any) => includeSold || a.status !== "sold")
    .map((a: any) => ({ ...a, distanceMi: within(a) }))
    .filter((a: any) => a.distanceMi !== null)
    .sort((x: any, y: any) => x.distanceMi - y.distanceMi);

  const comps = (compRows ?? [])
    .filter((c: any) => layers.has(c.comp_type))
    .map((c: any) => ({ ...c, distanceMi: within(c) }))
    .filter((c: any) => c.distanceMi !== null)
    .sort((x: any, y: any) => x.distanceMi - y.distanceMi);

  const pipeline = (dealRows ?? [])
    .map((d: any) => {
      const dp = Array.isArray(d.properties) ? d.properties[0] : d.properties;
      if (!dp) return null;
      const distanceMi = within(dp);
      if (distanceMi === null) return null;
      return {
        id: d.id,
        stage: d.stage,
        assetClass: d.asset_class,
        address: dp.address,
        city: dp.city,
        market: dp.market,
        latitude: Number(dp.latitude),
        longitude: Number(dp.longitude),
        distanceMi,
      };
    })
    .filter(Boolean)
    .sort((x: any, y: any) => x.distanceMi - y.distanceMi);

  // The zoom is chosen to fit the radius, then reported -- the caller's pin
  // placement depends on the zoom the imagery was ACTUALLY rendered at, and
  // Static Maps only accepts integer zooms.
  const zoom = zoomForRadiusMiles(radiusMiles, lat, MAP_LOGICAL_SIZE);

  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${MAP_LOGICAL_SIZE}x${MAP_LOGICAL_SIZE}`);
  url.searchParams.set("scale", String(MAP_SCALE));
  url.searchParams.set("maptype", maptype);
  // jpg for satellite (photographic, and png8's 256-colour palette turns
  // aerial imagery to grey mush); png for the road basemap, where flat colour
  // and crisp label text are the whole point and JPEG would fuzz them.
  url.searchParams.set("format", maptype === "satellite" ? "jpg" : "png");
  url.searchParams.set("key", GOOGLE_KEY ?? "");

  let imageBase64 = "";
  if (includeImage) {
    let r: Response;
    try {
      r = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    } catch {
      return NextResponse.json({ error: "The basemap request timed out or could not connect. Please retry." }, { status: 502 });
    }
    if (!r.ok) {
      return NextResponse.json(
        { error: `Static Maps request failed: ${r.status}` },
        { status: 502 }
      );
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = maptype === "satellite" ? "image/jpeg" : "image/png";
    imageBase64 = `data:${mime};base64,${buf.toString("base64")}`;
  }

  return NextResponse.json({
    target: {
      address: prop.address ?? "This deal",
      city: prop.city ?? null,
      market: prop.market ?? null,
      submarket: prop.submarket ?? null,
      buildingSf: prop.building_sf != null ? Number(prop.building_sf) : null,
      lotSf: prop.lot_sf != null ? Number(prop.lot_sf) : null,
      stage: deal.stage,
      assetClass: deal.asset_class,
      lat,
      lng,
    },
    assets,
    comps,
    pipeline,
    radiusMiles,
    maptype,
    zoom,
    mapLogicalSize: MAP_LOGICAL_SIZE,
    mapScale: MAP_SCALE,
    imageBase64,
  });
}
