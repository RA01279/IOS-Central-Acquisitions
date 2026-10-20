import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { geocodeDetailed } from "@/lib/geocode";
import { locateSite } from "@/lib/locate-site";

// POST { address, city?, state?, market?, retries? }
// retries: true (New deal > Portfolio OM) also tries the address with
// directions abbreviated, the road alone, and a Places search before giving
// up (lib/locate-site). Either way a miss comes back with Google's reason.
export async function POST(req: NextRequest) {
  if (!await getCurrentUser(req)) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.address !== "string" || !body.address.trim()) return NextResponse.json({ error: "Enter a street address first." }, { status: 400 });
  if ([body.address, body.city, body.market, body.state].some(v => v != null && (typeof v !== "string" || v.length > 300))) return NextResponse.json({ error: "Invalid address fields." }, { status: 400 });

  if (body.retries === true) {
    const site = await locateSite({ address: body.address, city: body.city, state: body.state, market: body.market });
    return NextResponse.json(site.found
      ? { location: { latitude: site.latitude, longitude: site.longitude, geocode_precision: site.precision }, matchedAddress: site.matchedAddress, via: site.via, note: site.note }
      : { location: null, reason: site.reason, message: `Google couldn't locate it. ${site.reason}` });
  }

  const out = await geocodeDetailed([body.address, body.city, body.market], { state: body.state, requirePrecise: true });
  return NextResponse.json(out.result ? { location: { latitude: out.result.lat, longitude: out.result.lng, geocode_precision: out.result.precision }, matchedAddress: out.result.formatted } : {
    location: null, reason: out.reason,
    message: `Google could not verify the exact property: ${out.reason} Check the address, city and state, then retry or place a pin manually.`,
  });
}
