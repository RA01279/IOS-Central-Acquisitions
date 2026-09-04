// app/api/assets/[id]/route.ts
// Edit one owned asset.
//
// Narrow on purpose. The seed owns address, city, state, status and occupancy
// -- those come from dalfen.com/ios and a re-seed refreshes them. What this
// route writes is the things the source page DOESN'T publish and a person has
// to supply: acreage, building size, submarket, notes, and a coordinate pin.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ("siteAcres" in body) {
    const acres = num(body.siteAcres);
    if (acres !== null && acres <= 0) {
      return NextResponse.json({ error: "Acreage has to be greater than zero." }, { status: 400 });
    }
    update.site_acres = acres;
  }
  if ("buildingSf" in body) {
    const sf = num(body.buildingSf);
    if (sf !== null && sf <= 0) {
      return NextResponse.json({ error: "Building SF has to be greater than zero." }, { status: 400 });
    }
    update.building_sf = sf;
  }
  if ("submarket" in body) update.submarket = str(body.submarket);
  if ("notes" in body) update.notes = str(body.notes);
  if ("market" in body) update.market = str(body.market);
  if ("status" in body) {
    const s = str(body.status);
    if (s && !["owned", "sold", "under_contract"].includes(s)) {
      return NextResponse.json({ error: `Unknown status "${s}".` }, { status: 400 });
    }
    update.status = s ?? "owned";
  }

  // A pin dropped by hand, same contract as a comp's: it wins, it's marked
  // 'manual', and nothing re-geocodes over it.
  if ("latitude" in body || "longitude" in body) {
    const lat = num(body.latitude);
    const lng = num(body.longitude);
    if (lat === null || lng === null) {
      update.latitude = null;
      update.longitude = null;
      update.geocode_precision = null;
    } else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json(
        { error: `Those coordinates are off the map (${lat}, ${lng}).` },
        { status: 400 }
      );
    } else if (lat === 0 && lng === 0) {
      return NextResponse.json(
        { error: "0, 0 is in the Atlantic. Clear both fields to remove the location instead." },
        { status: 400 }
      );
    } else {
      update.latitude = lat;
      update.longitude = lng;
      update.geocode_precision = "manual";
      update.geocoded_at = new Date().toISOString();
    }
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "No editable fields in the request" }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();
  update.updated_by = user.email;

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("assets")
    .update(update)
    .eq("id", params.id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  return NextResponse.json({ asset: data });
}
