import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

// Six IOS demand categories, with a Places "keyword" tuned for each. Callers can
// override via ?categories=Label1:keyword one,Label2:keyword two if a deal needs
// a different mix -- but the defaults cover the standard IOS screen.
const DEFAULT_CATEGORIES: { label: string; keyword: string }[] = [
  { label: "Auto Storage", keyword: "vehicle RV boat storage" },
  { label: "Building Materials", keyword: "building materials supplier" },
  { label: "Chemical/Waste Mgmt", keyword: "waste management chemical distributor" },
  { label: "Container Storage", keyword: "shipping container storage" },
  { label: "Contractor Yard", keyword: "general contractor construction" },
  { label: "Equip. Rental & Sales", keyword: "equipment rental sales" },
];

const GOOGLE_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;

type Tenant = {
  name: string;
  category: string;
  lat: number;
  lng: number;
  placeId: string;
  distanceMi: number;
};

// GET /api/deals/[id]/demand-map?radiusMiles=5
//
// No lat/lng stored on properties -- the address is geocoded on the fly each
// call rather than cached, since this is an occasional IC-deck export, not a
// hot path, and it means a corrected address is always reflected immediately.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!GOOGLE_KEY) {
    return NextResponse.json({ error: "GOOGLE_MAPS_SERVER_KEY not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const radiusMiles = Number(url.searchParams.get("radiusMiles") ?? "5") || 5;
  const categories = parseCategoriesParam(url.searchParams.get("categories")) ?? DEFAULT_CATEGORIES;
  // "hybrid" is satellite plus road and place labels -- often the better IC
  // basemap, since viewers orient off the highway names. Anything else falls
  // back to plain satellite.
  const maptype = url.searchParams.get("maptype") === "hybrid" ? "hybrid" : "satellite";

  const supabase = getServiceClient();

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, property_id")
    .eq("id", params.id)
    .single();
  if (dealError || !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (!deal.property_id) {
    return NextResponse.json({ error: "Deal has no linked property/address" }, { status: 400 });
  }

  const { data: property, error: propError } = await supabase
    .from("properties")
    .select("address, city, market, submarket")
    .eq("id", deal.property_id)
    .single();
  if (propError || !property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const fullAddress = [property.address, property.city, "TX"].filter(Boolean).join(", ");

  try {
    const center = await geocode(fullAddress);
    const tenants = await searchNearby({ ...center, radiusMiles, categories });
    const { imageBase64, zoom } = await fetchSatelliteImage({ ...center, radiusMiles, maptype });

    return NextResponse.json({
      address: fullAddress,
      center,
      radiusMiles,
      zoom,
      maptype,
      // Reported rather than assumed by the client. Both the preview overlay
      // and the .pptx have to project lat/lng onto this exact image, and
      // hardcoding its dimensions in two places is what let them silently
      // disagree with what the API actually returns.
      mapLogicalSize: MAP_LOGICAL_SIZE,
      mapScale: MAP_SCALE,
      // The basemap itself, as a data: URI. Was being fetched and then left out
      // of this response, so the preview rendered a broken <img> and the .pptx
      // got an empty image box -- pins on white, with the Static Maps call paid
      // for and discarded on every generate.
      imageBase64,
      tenants,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

function parseCategoriesParam(raw: string | null): { label: string; keyword: string }[] | null {
  if (!raw) return null;
  return raw.split(",").map((pair) => {
    const [label, keyword] = pair.split(":");
    return { label: label?.trim() ?? pair, keyword: (keyword ?? label)?.trim() };
  });
}

async function geocode(address: string): Promise<{ lat: number; lng: number }> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_KEY!);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) {
    throw new Error(`Geocoding failed for "${address}": ${data.status} ${data.error_message ?? ""}`);
  }
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

async function searchNearby({
  lat,
  lng,
  radiusMiles,
  categories,
}: {
  lat: number;
  lng: number;
  radiusMiles: number;
  categories: { label: string; keyword: string }[];
}): Promise<Tenant[]> {
  const radiusMeters = Math.round(radiusMiles * 1609.34);

  const resultsByCategory = await Promise.all(
    categories.map(async (cat) => {
      const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
      url.searchParams.set("location", `${lat},${lng}`);
      url.searchParams.set("radius", String(radiusMeters));
      url.searchParams.set("keyword", cat.keyword || cat.label);
      url.searchParams.set("key", GOOGLE_KEY!);

      const r = await fetch(url.toString());
      const data = await r.json();
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        console.error(`Places error for "${cat.label}":`, data.status, data.error_message);
        return [] as Tenant[];
      }
      return (data.results || []).map((place: any) => ({
        name: place.name,
        category: cat.label,
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        placeId: place.place_id,
        distanceMi: haversineMiles(lat, lng, place.geometry.location.lat, place.geometry.location.lng),
      })) as Tenant[];
    })
  );

  let tenants = resultsByCategory.flat().filter((t) => t.distanceMi <= radiusMiles);

  // de-dupe by placeId (the same business can surface under more than one keyword),
  // cap per category so the map/legend stay readable on one IC slide
  const seen = new Set<string>();
  const perCategoryCount: Record<string, number> = {};
  tenants = tenants
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .filter((t) => {
      if (seen.has(t.placeId)) return false;
      seen.add(t.placeId);
      perCategoryCount[t.category] = (perCategoryCount[t.category] || 0) + 1;
      return perCategoryCount[t.category] <= 8;
    });

  return tenants;
}

// The Maps Static API caps `size` at 640x640 LOGICAL pixels. A larger request
// isn't an error -- it's silently clamped -- which is how this ended up asking
// for 1280x1024 and getting 640x640 back, while the zoom maths and the client's
// projection both believed they had 1280 px of width to work with. Everything
// downstream was consequently framed for twice the coverage it actually had.
// scale=2 is the one legitimate way to get more pixels: it doubles the raster
// (1280x1280 out) without changing the geographic coverage.
const MAP_LOGICAL_SIZE = 640;
const MAP_SCALE = 2;

async function fetchSatelliteImage({
  lat,
  lng,
  radiusMiles,
  maptype,
}: {
  lat: number;
  lng: number;
  radiusMiles: number;
  maptype: string;
}): Promise<{ imageBase64: string; zoom: number }> {
  const zoom = zoomForRadiusMiles(radiusMiles, lat);
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${MAP_LOGICAL_SIZE}x${MAP_LOGICAL_SIZE}`);
  url.searchParams.set("scale", String(MAP_SCALE));
  url.searchParams.set("maptype", maptype);
  // format is the difference between real satellite imagery and something that
  // looks like a grayscale scan of it. The API defaults to png8 -- a 256-colour
  // indexed palette -- which posterises aerial photography into flat blue-grey
  // mush. jpg gives 24-bit truecolour (and a third of the bytes), which is the
  // right trade for a photographic basemap; lossy artefacts are invisible here.
  url.searchParams.set("format", "jpg");
  url.searchParams.set("key", GOOGLE_KEY!);

  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Static Maps request failed: ${r.status} ${await r.text()}`);

  const buf = Buffer.from(await r.arrayBuffer());
  return { imageBase64: `data:image/jpeg;base64,${buf.toString("base64")}`, zoom };
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Closest zoom that still fits the whole requested radius on the image.
//
// Measured against MAP_LOGICAL_SIZE, not the old hardcoded 1280: the image is
// square and 640 logical px per side, so using 1280 asked for a zoom covering
// twice the ground the image actually shows, and tenants past roughly half the
// radius landed outside the frame. The margin is only 2% because zoom steps are
// powers of two -- a bigger cushion just tips it to the next level out and
// throws away half the detail for nothing.
function zoomForRadiusMiles(radiusMiles: number, lat: number): number {
  const diameterMeters = radiusMiles * 2 * 1609.34 * 1.02;
  for (let z = 20; z >= 1; z--) {
    const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    if (metersPerPixel * MAP_LOGICAL_SIZE >= diameterMeters) return z;
  }
  return 12;
}
