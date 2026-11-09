// app/api/deals/[id]/offer-round/route.ts
//
// Bid rounds on an acquisition. POST { dueOn } starts the next round (round 1
// -> best & final -> round 3...) and sets its due date. PATCH { dueOn?, round? }
// corrects the current round's date or number. The due date lives in
// deals.call_for_offers_on, so tiles, the daily brief and the day-before
// reminder all pick it up (lib/call-for-offers.ts).
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { logDealEvent } from "@/lib/deals";
import { validDate } from "@/lib/stage-rules";

const MAX_ROUND = 9;

async function current(id: string) {
  const { data, error } = await getServiceClient()
    .from("deals").select("id, deal_type, offer_round, call_for_offers_on").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.dueOn || !validDate(body.dueOn)) return NextResponse.json({ error: "Enter the due date for the new round" }, { status: 400 });

  const deal = await current(id);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.deal_type !== "acquisition") return NextResponse.json({ error: "Bid rounds apply to acquisitions" }, { status: 400 });
  const from = Number(deal.offer_round) || 1;
  if (from >= MAX_ROUND) return NextResponse.json({ error: `Hopper tracks up to ${MAX_ROUND} rounds` }, { status: 400 });

  // Conditional on the round we read, so a double-click can't skip a round.
  const { data, error } = await getServiceClient()
    .from("deals").update({ offer_round: from + 1, call_for_offers_on: body.dueOn })
    .eq("id", id).eq("offer_round", from).select("offer_round, call_for_offers_on");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "The round changed while you were editing. Reload and try again." }, { status: 409 });
  await logDealEvent(id, "offer_round_started", { round: from + 1, dueOn: body.dueOn, previousDueOn: deal.call_for_offers_on }, user.email);
  return NextResponse.json({ ok: true, round: data[0].offer_round, dueOn: data[0].call_for_offers_on });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  if ("dueOn" in body) {
    if (body.dueOn && !validDate(body.dueOn)) return NextResponse.json({ error: "Enter a valid due date" }, { status: 400 });
    update.call_for_offers_on = body.dueOn || null;
  }
  if ("round" in body) {
    const r = Number(body.round);
    if (!Number.isInteger(r) || r < 1 || r > MAX_ROUND) return NextResponse.json({ error: `Round must be 1-${MAX_ROUND}` }, { status: 400 });
    update.offer_round = r;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const deal = await current(id);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const { error } = await getServiceClient().from("deals").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logDealEvent(id, "offer_round_updated", { before: { round: deal.offer_round, dueOn: deal.call_for_offers_on }, ...update }, user.email);
  return NextResponse.json({ ok: true });
}
