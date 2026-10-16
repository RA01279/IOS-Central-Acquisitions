import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent } from "@/lib/deals";
import { fireStageChangeWebhook } from "@/lib/webhooks";
import { getCurrentUser, canConfirmPsa } from "@/lib/auth";

// Restoring into one of these is the same as confirming the PSA, so it needs
// the same sign-off.
const PSA_OR_LATER = new Set(["moving_to_psa", "due_diligence", "closed"]);

// POST /api/deals/[id]/archive
// body: { action: "archive", reason: string, ... } | { action: "restore" }
// The stage a deal dies at is read here, never taken from the request, so a
// restore can only put a deal back where it really was.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const supabase = getServiceClient();
  const { data: deal, error: readError } = await supabase
    .from("deals")
    .select("stage, death_stage, death_reason")
    .eq("id", params.id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  if (body.action === "archive") {
    if (deal.stage === "archived") return NextResponse.json({ error: "Deal is already archived" }, { status: 409 });
    // A closed deal is an owned asset; archiving it would un-own the asset.
    if (deal.stage === "closed") {
      return NextResponse.json({ error: "Closed deals can't be archived. Record a sale on the asset instead." }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "Give a reason for archiving" }, { status: 400 });

    // Targeting is captured AT archive time (score 0 = never a target), so
    // deals don't have to be hunted down later to classify them.
    const update: Record<string, unknown> = {
      stage: "archived",
      death_stage: deal.stage,
      death_reason: reason,
    };
    if (body.disposition) update.disposition = body.disposition;
    if (body.pursuitScore !== undefined && body.pursuitScore !== null && body.pursuitScore !== "") {
      const score = Number(body.pursuitScore);
      if (!Number.isFinite(score)) return NextResponse.json({ error: "Pursuit score must be a number" }, { status: 400 });
      update.pursuit_score = score;
    }
    if (body.followUpOn) update.follow_up_on = body.followUpOn;

    // Conditional on the stage just read, so a concurrent stage move isn't overwritten.
    const { data: moved, error } = await supabase
      .from("deals").update(update).eq("id", params.id).eq("stage", deal.stage).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!moved?.length) return NextResponse.json({ error: "The deal changed. Refresh and try again." }, { status: 409 });
    await logDealEvent(
      params.id,
      "archived",
      {
        stage: deal.stage,
        reason,
        score: update.pursuit_score ?? null,
        follow_up: body.followUpOn ?? null,
      },
      user.email
    );
    await fireStageChangeWebhook(params.id, {
      from: deal.stage,
      to: "archived",
      actor: user.email,
      via: "archive",
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "restore") {
    if (deal.stage !== "archived") return NextResponse.json({ error: "Only archived deals can be restored" }, { status: 409 });
    // Back to the stage it died at. uw_v1 was retired into UW (0007); a deal
    // with no recorded stage goes to UW.
    const toStage = !deal.death_stage || deal.death_stage === "uw_v1" ? "uw" : deal.death_stage;
    if (PSA_OR_LATER.has(toStage) && !canConfirmPsa(user.email)) {
      return NextResponse.json({ error: "Only Rhett/John can restore a deal into PSA or later" }, { status: 403 });
    }
    const { data: moved, error } = await supabase
      .from("deals")
      .update({ stage: toStage, death_stage: null, death_reason: null })
      .eq("id", params.id)
      .eq("stage", "archived")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!moved?.length) return NextResponse.json({ error: "The deal changed. Refresh and try again." }, { status: 409 });
    // The death fields are cleared on the deal; keep them on the event so the
    // loss history survives the restore.
    await logDealEvent(
      params.id,
      "restored",
      { to: toStage, died_at: deal.death_stage, reason: deal.death_reason },
      user.email
    );
    await fireStageChangeWebhook(params.id, {
      from: "archived",
      to: toStage,
      actor: user.email,
      via: "restore",
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
