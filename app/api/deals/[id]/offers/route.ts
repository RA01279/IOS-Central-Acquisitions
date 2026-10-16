// app/api/deals/[id]/offers/route.ts
// Offer history for a deal -- the tracker's "Last Offer Date/Price" and
// "Times We've Offered" as real rows. The insert itself (plus the
// prospect/uw -> Offered advance) lives in recordOffer(), shared with LOI
// generation so an LOI at a price lands in the offer log automatically.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent, recordOffer } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";
import { parseMoney } from "@/lib/money";
import { validDate } from "@/lib/stage-rules";
import { OFFER_STATUSES } from "@/lib/offer-status";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();

  try {
    const { offer } = await recordOffer(
      params.id,
      {
        price: body.price ?? null,
        offeredAt: body.offeredAt ?? null,
        notes: body.notes ?? null,
        source: "manual",
      },
      user.email
    );
    return NextResponse.json({ offer }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH { offerId, status?, counterPrice?, respondedOn? } -- the seller's answer.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.offerId) return NextResponse.json({ error: "offerId is required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if ("status" in body) {
    if (!(OFFER_STATUSES as readonly string[]).includes(body.status)) return NextResponse.json({ error: "Unknown offer status" }, { status: 400 });
    update.status = body.status;
  }
  try {
    if ("counterPrice" in body) update.counter_price = parseMoney(body.counterPrice);
  } catch (err: any) {
    return NextResponse.json({ error: `Counter price: ${err.message}` }, { status: 400 });
  }
  if ("respondedOn" in body) {
    if (body.respondedOn && !validDate(body.respondedOn)) return NextResponse.json({ error: "Enter a valid response date" }, { status: 400 });
    update.responded_on = body.respondedOn || null;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  // A counter without a status is a counter.
  if (update.counter_price && !("status" in update)) update.status = "countered";

  const { data, error } = await getServiceClient()
    .from("offers").update(update).eq("id", body.offerId).eq("deal_id", params.id).select("id, price, status, counter_price");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Offer not found on this deal" }, { status: 404 });
  await logDealEvent(params.id, "offer_response", { offer_id: body.offerId, ...update }, user.email);
  return NextResponse.json({ ok: true, offer: data[0] });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.offerId) return NextResponse.json({ error: "offerId is required" }, { status: 400 });

  const supabase = getServiceClient();
  const { error } = await supabase
    .from("offers")
    .delete()
    .eq("id", body.offerId)
    .eq("deal_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logDealEvent(params.id, "offer_removed", { offer_id: body.offerId }, user.email);
  return NextResponse.json({ ok: true });
}
