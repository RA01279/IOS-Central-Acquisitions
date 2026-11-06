import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { bearerMatches } from "@/lib/sync-export";
import { backfillCompPlaces } from "@/lib/comps/backfill-places";

// Daily: fill blank comp markets / submarkets from their pins (lib/comps/backfill-places).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatches(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await backfillCompPlaces(getServiceClient());
  return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
}
