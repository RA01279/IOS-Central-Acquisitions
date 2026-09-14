import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { geocodeAddress } from "@/lib/geocode";

export async function POST(req: NextRequest) {
  if (!await getCurrentUser(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.address !== "string" || !body.address.trim() || body.address.length > 300) {
    return NextResponse.json({ error: "Enter a street address, city and state (up to 300 characters)." }, { status: 400 });
  }
  const location = await geocodeAddress([body.address.trim()], { requirePrecise: true });
  return NextResponse.json(location ? {
    location: { latitude: location.lat, longitude: location.lng, geocode_precision: location.precision },
    matchedAddress: location.formatted,
  } : { location: null, message: "Could not verify this property. Check the street address, city and state, then retry." });
}
