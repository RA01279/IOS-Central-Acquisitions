import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";

// POST /api/deals/[id]/archive
// body: { action: "archive", stage: string, reason: string } | { action: "restore" }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const supabase = getServiceClient();

  if (body.action === "archive") {
    const { error } = await supabase
      .from("deals")
      .update({ stage: "archived", death_stage: body.stage, death_reason: body.reason })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(params.id, "archived", { stage: body.stage, reason: body.reason }, user.email);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "restore") {
    // TODO(claude-code): decide which stage a restored deal returns to --
    // probably death_stage, but confirm with Rhett before building.
    const { data: deal } = await supabase.from("deals").select("death_stage").eq("id", params.id).single();
    const { error } = await supabase
      .from("deals")
      .update({ stage: deal?.death_stage ?? "uw", death_stage: null, death_reason: null })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(params.id, "restored", {}, user.email);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
