import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent, isValidAcqStage, STAGE_LABELS } from "@/lib/deals";
import { fireStageChangeWebhook } from "@/lib/webhooks";
import { getCurrentUser, canConfirmPsa } from "@/lib/auth";

// A price off a form: "4,200,000" / "$4.2M" -> 4200000, or null when there's
// no usable positive number. The DB has CHECK (> 0) on both price columns, so a
// zero or a stray character has to become null rather than reach Postgres.
function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Every stage move goes through here so the audit event and the outbound
// webhook fire in exactly one place per transition.
async function advance(
  dealId: string,
  toStage: string,
  eventType: string,
  detail: Record<string, unknown>,
  actor: string,
  extraColumns: Record<string, unknown> = {}
) {
  const supabase = getServiceClient();
  const { data: before } = await supabase
    .from("deals")
    .select("stage")
    .eq("id", dealId)
    .maybeSingle();

  const { error } = await supabase
    .from("deals")
    .update({ stage: toStage, ...extraColumns })
    .eq("id", dealId);
  if (error) return { error: error.message };

  await logDealEvent(dealId, eventType, detail, actor);
  await fireStageChangeWebhook(dealId, { from: before?.stage ?? null, to: toStage, actor });
  return { error: null };
}

// PATCH /api/deals/[id]
// body:
//   { action: "mark_offered" }
//   { action: "confirm_psa" }                              -- gated by canConfirmPsa()
//   { action: "move_to_due_diligence", ddEndOn, closingOn } -- PSA executed
//   { action: "mark_closed", closedOn }                     -- deal closed
//   { action: "set_acq_stage", toStage: "uw" }              -- stage correction
//   { action: "set_targeting", ... }                        -- archive scoring
//   { action: "update_details", ... }                       -- edit deal + property
//   { action: "provide_mla", ...mlaFields }                 -- fills in MLA after a request
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req as any);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const supabase = getServiceClient();

  if (body.action === "mark_offered") {
    const { error } = await advance(params.id, "offered", "marked_offered", {}, user.email);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "confirm_psa") {
    if (!canConfirmPsa(user.email)) {
      return NextResponse.json(
        { error: "Only Rhett/John can confirm Moving to PSA" },
        { status: 403 }
      );
    }
    // The PSA price is usually agreed by the time this is confirmed. Optional --
    // a missing price must not block the stage move -- and only written when
    // present, so confirming without one can't wipe a price already recorded.
    const contractPrice = parseMoney(body.contractPrice);
    const { error } = await advance(
      params.id,
      "moving_to_psa",
      "confirmed_psa",
      contractPrice === null ? {} : { contract_price: contractPrice },
      user.email,
      contractPrice === null ? {} : { contract_price: contractPrice }
    );
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // PSA executed -> the deal enters Due Diligence, carrying the two dates the
  // morning brief warns on. Both optional: a DD period that isn't pinned down
  // yet shouldn't block the stage move.
  if (body.action === "move_to_due_diligence") {
    const columns: Record<string, unknown> = {
      dd_end_on: body.ddEndOn ?? null,
      closing_on: body.closingOn ?? null,
    };
    // By PSA execution the contract price is known for certain. Same rule as
    // above: only written when present.
    const contractPrice = parseMoney(body.contractPrice);
    if (contractPrice !== null) columns.contract_price = contractPrice;

    const { error } = await advance(
      params.id,
      "due_diligence",
      "entered_due_diligence",
      columns,
      user.email,
      columns
    );
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Closed. closed_on is what the home screen's date ranges count on, so it's
  // required rather than defaulted silently to today.
  if (body.action === "mark_closed") {
    if (!body.closedOn) {
      return NextResponse.json({ error: "A closing date is required" }, { status: 400 });
    }
    // The closing price is required here, unlike the contract price. This is the
    // number that ends up in the boss's closed subtotal, and a closing with no
    // price forces that subtotal to fall back to an offer -- which is the exact
    // problem these columns exist to remove.
    const closedPrice = parseMoney(body.closedPrice);
    if (closedPrice === null) {
      return NextResponse.json(
        { error: "A closing price is required (this is what the closed totals report)" },
        { status: 400 }
      );
    }
    const columns = { closed_on: body.closedOn, closed_price: closedPrice };
    const { error } = await advance(
      params.id,
      "closed",
      "marked_closed",
      columns,
      user.email,
      columns
    );
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Stage correction -- lets a deal move BACKWARD when someone advanced it by
  // mistake. Any acquisition stage is a legal target; the DB constraint still
  // guards against cross-pipeline stages. Moving back out of Closed clears the
  // closing date AND price, otherwise an un-closed deal keeps contributing to
  // the closing totals. contract_price is deliberately NOT cleared -- the PSA
  // price is still true after a mis-click is corrected.
  if (body.action === "set_acq_stage") {
    const toStage = body.toStage;
    if (!isValidAcqStage(toStage)) {
      return NextResponse.json({ error: "Not a valid acquisition stage" }, { status: 400 });
    }
    const { error } = await advance(
      params.id,
      toStage,
      "stage_corrected",
      { to: toStage, label: STAGE_LABELS[toStage] ?? toStage },
      user.email,
      toStage === "closed" ? {} : { closed_on: null, closed_price: null }
    );
    if (error) return NextResponse.json({ error }, { status: 500 });
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

  // Edit deal + property details in one shot ("all things editable").
  if (body.action === "update_details") {
    const { data: deal } = await supabase
      .from("deals")
      .select("property_id")
      .eq("id", params.id)
      .single();
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    if (deal.property_id) {
      const { error: propErr } = await supabase
        .from("properties")
        .update({
          address: body.address,
          city: body.city || null,
          market: body.market || null,
          submarket: body.submarket || null,
          asset_type: body.assetType || null,
          lot_sf: body.acres ? Math.round(Number(body.acres) * 43560) : null,
          building_sf: body.buildingSf ? Number(body.buildingSf) : null,
          occupancy_status: body.occupancyStatus || null,
          walt_years:
            body.occupancyStatus === "occupied" && body.waltYears ? Number(body.waltYears) : null,
          tenancy: body.tenancy || null,
        })
        .eq("id", deal.property_id);
      if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 });
    }

    const dealUpdate: Record<string, unknown> = {
      marketing_status: body.marketingStatus || null,
      acquisition_type: body.acquisitionType || null,
      dd_end_on: body.ddEndOn || null,
      closing_on: body.closingOn || null,
      // Both prices are clearable here (unlike the stage transitions, where a
      // blank must not wipe a recorded price) -- the edit form always submits
      // both fields, so a cleared input genuinely means "remove this".
      contract_price: parseMoney(body.contractPrice),
      closed_price: parseMoney(body.closedPrice),
    };
    // asset_class is NOT NULL -- only write it when a valid value came in, so a
    // caller that omits the field can't null out which pipeline a deal is in.
    if (body.assetClass === "ios" || body.assetClass === "industrial") {
      dealUpdate.asset_class = body.assetClass;
    }

    const { error: dealErr } = await supabase
      .from("deals")
      .update(dealUpdate)
      .eq("id", params.id);
    if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });

    await logDealEvent(params.id, "details_edited", {}, user.email);
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
