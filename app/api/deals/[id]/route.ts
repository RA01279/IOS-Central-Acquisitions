import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent, isValidLeaseStage, STAGE_LABELS } from "@/lib/deals";
import { getCurrentUser, canConfirmPsa } from "@/lib/auth";

// PATCH /api/deals/[id]
// body:
//   { action: "mark_offered" }
//   { action: "confirm_psa" }                    -- gated by canConfirmPsa()
//   { action: "provide_mla", ...mlaFields }       -- fills in MLA after a request
//   { action: "set_lease_stage", toStage: "tour" } -- leasing pipeline moves
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const supabase = getServiceClient();

  // Leasing pipeline transition. Any of the three can move a lease along; the
  // executed/PSA-equivalent isn't gated the way acquisitions PSA is, since a
  // signed lease is confirmed by document, not by a role check.
  if (body.action === "set_lease_stage") {
    const toStage = body.toStage;
    if (!isValidLeaseStage(toStage)) {
      return NextResponse.json({ error: "Not a valid leasing stage" }, { status: 400 });
    }
    const { error } = await supabase.from("deals").update({ stage: toStage }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(
      params.id,
      "lease_stage_changed",
      { to: toStage, label: STAGE_LABELS[toStage] ?? toStage },
      user.email
    );
    return NextResponse.json({ ok: true });
  }

  if (body.action === "mark_offered") {
    const { error } = await supabase.from("deals").update({ stage: "offered" }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(params.id, "marked_offered", {}, user.email);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "confirm_psa") {
    if (!canConfirmPsa(user.email)) {
      return NextResponse.json(
        { error: "Only Rhett/John can confirm Moving to PSA" },
        { status: 403 }
      );
    }
    const { error } = await supabase.from("deals").update({ stage: "moving_to_psa" }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(params.id, "confirmed_psa", {}, user.email);
    return NextResponse.json({ ok: true });
  }

  // PSA executed -> the deal enters Due Diligence.
  if (body.action === "move_to_due_diligence") {
    const { error } = await supabase.from("deals").update({ stage: "due_diligence" }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(params.id, "entered_due_diligence", {}, user.email);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "provide_mla") {
    const { error: mlaError } = await supabase.from("mla_data").insert({
      deal_id: params.id,
      market_base_rent: body.marketBaseRent ?? null,
      term_years: body.termYears ?? null,
      term_months: body.termMonths ?? null,
      renewal_probability: body.renewalProbability ?? null,
      months_vacant: body.monthsVacant ?? null,
      free_rent_months: body.freeRentMonths ?? null,
      ti_new: body.tiNew ?? null,
      ti_renew: body.tiRenew ?? null,
      lc_new_pct: body.lcNewPct ?? null,
      lc_renew_pct: body.lcRenewPct ?? null,
      recovery_type: body.recoveryType ?? null,
      provided_by: user.email,
      provided_at: new Date().toISOString(),
    });
    if (mlaError) return NextResponse.json({ error: mlaError.message }, { status: 500 });

    const { error: dealError } = await supabase
      .from("deals")
      .update({ mla_status: "provided" })
      .eq("id", params.id);
    if (dealError) return NextResponse.json({ error: dealError.message }, { status: 500 });

    await logDealEvent(params.id, "mla_provided", {}, user.email);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
