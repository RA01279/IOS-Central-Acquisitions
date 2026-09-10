import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { hasMapCoordinates } from "@/lib/comps/mapData";
import { geocodeAddress } from "@/lib/geocode";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await getCurrentUser(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const db = getServiceClient();
  const { data: deal, error } = await db.from("deals")
    .select("property_id,properties(address,city,market,latitude,longitude,geocode_precision)").eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deal?.property_id) return NextResponse.json({ error: "Deal property not found" }, { status: 404 });
  const property = Array.isArray(deal.properties) ? deal.properties[0] : deal.properties;
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (hasMapCoordinates(property)) return NextResponse.json({ property, existing: true });
  const location = await geocodeAddress([property.address, property.city, property.market], { requirePrecise: true });
  if (!location) return NextResponse.json({ needsManual: true, message: "Google could not establish a confident address match, or the lookup is unavailable. Please place the property manually." });
  const { data: saved, error: saveError } = await db.from("properties").update({
    latitude: location.lat, longitude: location.lng, geocode_precision: location.precision, geocoded_at: new Date().toISOString(),
  }).eq("id", deal.property_id).eq("address", property.address)
    .or("latitude.is.null,longitude.is.null")
    .select("latitude,longitude,geocode_precision").maybeSingle();
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  if (!saved) return NextResponse.json({ error: "The property changed during lookup. Refresh before trying again." }, { status: 409 });
  return NextResponse.json({ property: saved, matchedAddress: location.formatted });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !["number", "string"].includes(typeof body.latitude) ||
      !["number", "string"].includes(typeof body.longitude) ||
      String(body.latitude).trim() === "" || String(body.longitude).trim() === "" || !hasMapCoordinates(body)) {
    return NextResponse.json({ error: "Enter both coordinates: latitude from -90 to 90 and longitude from -180 to 180." }, { status: 400 });
  }
  const db = getServiceClient();
  const { data: deal, error } = await db.from("deals").select("property_id").eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deal?.property_id) return NextResponse.json({ error: "Deal property not found" }, { status: 404 });
  const { data: property, error: saveError } = await db.from("properties").update({
    latitude: Number(body.latitude), longitude: Number(body.longitude),
    geocode_precision: "manual", geocoded_at: new Date().toISOString(),
  }).eq("id", deal.property_id).select("id,latitude,longitude,geocode_precision").maybeSingle();
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  return NextResponse.json({ property });
}
