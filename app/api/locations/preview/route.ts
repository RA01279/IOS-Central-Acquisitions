import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { geocodeAddress } from "@/lib/geocode";

export async function POST(req: NextRequest) {
  if (!await getCurrentUser(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.address !== "string" || !body.address.trim()) return NextResponse.json({ error: "Enter a street address first." }, { status: 400 });
  if ([body.address, body.city, body.market, body.state].some(v => v != null && (typeof v !== "string" || v.length > 300))) return NextResponse.json({ error: "Invalid address fields." }, { status: 400 });
  const location = await geocodeAddress([body.address, body.city, body.market], { state: body.state, requirePrecise: true });
  return NextResponse.json(location ? { location: { latitude: location.lat, longitude: location.lng, geocode_precision: location.precision }, matchedAddress: location.formatted } : {
    location: null, message: "Google could not verify the exact property, or lookup is unavailable. Check the address, city and state, then retry or place a pin manually.",
  });
}
