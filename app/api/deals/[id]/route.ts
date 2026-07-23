import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent, isValidLeaseStage, STAGE_LABELS, ACQUISITION_STAGES } from "@/lib/deals";
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

  // Stage correction for acquisitions -- lets a deal move BACKWARD when
  // someone advanced it by mistake. Any acquisition stage is a legal target;
  // the DB constraint still guards against cross-pipeline stages.
  if (body.action === "set_acq_stage") {
    const toStage = body.toStage;
    if (!(ACQUISITION_STAGES as readonly string[]).includes(toStage)) {
      return NextResponse.json({ error: "Not a valid acquisition stage" }, { status: 400 });
    }
    const { error } = await supabase.from("deals").update({ stage: toStage }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(
      params.id,
      "stage_corrected",
      { to: toStage, label: STAGE_LABELS[toStage] ?? toStage },
      user.email
    );
    return NextResponse.json({ ok: true });
  }

  // Target repository scoring on archived deals: why it's parked, how badly
  // we want it (1-5), and when to re-approach the owner.
  if (body.action === "set_targeting") {
    const { error } = await supabase
      .from("deals")
      .update({
        disposition: body.disposition ?? null,
        pursuit_score: body.pursuitScore ?? null,
        follow_up_on: body.followUpOn ?? null,
      })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logDealEvent(
      params.id,
      "targeting_updated",
      { disposition: body.disposition ?? null, score: body.pursuitScore ?? null, follow_up: body.followUpOn ?? null },
      user.email
    );
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

// DELETE /api/deals/[id]
// Permanent removal, for duplicates and deals entered in error. Child rows
// (mla_data, uw_versions, documents, deal_events, deal_contacts, activities,
// tasks) all cascade via FK. The property row is deleted too when no other
// deal references it, so a duplicate intake leaves nothing behind. Files in
// storage are left as-is -- harmless orphans, cheap to keep.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getServiceClient();

  const { data: deal, error: findError } = await supabase
    .from("deals")
    .select("id, property_id")
    .eq("id", params.id)
    .single();
  if (findError || !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const { error: delError } = await supabase.from("deals").delete().eq("id", params.id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  if (deal.property_id) {
    const { data: siblings } = await supabase
      .from("deals")
      .select("id")
      .eq("property_id", deal.property_id)
      .limit(1);
    if (!siblings || siblings.length === 0) {
      await supabase.from("properties").delete().eq("id", deal.property_id);
    }
  }

  return NextResponse.json({ ok: true });
}
