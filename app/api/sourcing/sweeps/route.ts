import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { UUID } from "@/lib/agents/catalog";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (id && !UUID.test(id)) return NextResponse.json({ error: "Invalid sweep" }, { status: 400 });
  const db = getServiceClient();
  if (id) {
    const { data, error } = await db.from("sourcing_sweeps").select("id,snapshot,created_at").eq("id", id).eq("owner_email", user.email.toLowerCase()).maybeSingle();
    if (error) return NextResponse.json({ error: "Sweep unavailable" }, { status: 503 });
    return data ? NextResponse.json({ ...data.snapshot, sweepId: data.id }, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ error: "Sweep not found" }, { status: 404 });
  }
  const { data, error } = await db.from("sourcing_sweeps").select("id,created_at,snapshot->label,snapshot->market").eq("owner_email", user.email.toLowerCase()).order("created_at", { ascending: false }).limit(20);
  return error ? NextResponse.json({ error: "Could not load saved sweeps" }, { status: 503 }) : NextResponse.json({ sweeps: data }, { headers: { "Cache-Control": "private, no-store" } });
}
