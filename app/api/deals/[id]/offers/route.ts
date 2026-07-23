// app/api/deals/[id]/offers/route.ts
// Offer history for a deal -- the tracker's "Last Offer Date/Price" and
// "Times We've Offered" as real rows. Logging an offer on a deal still at
// Prospect/UW auto-advances it to Offered, since making an offer IS what
// makes a deal offered.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const supabase = getServiceClient();

  const { data: offer, error } = await supabase
    .from("offers")
    .insert({
      deal_id: params.id,
      offered_at: body.offeredAt ?? new Date().toISOString().slice(0, 10),
      price: body.price ?? null,
      notes: body.notes ?? null,
      created_by: user.email,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logDealEvent(params.id, "offer_logged", { price: body.price ?? null }, user.email);

  // Making an offer moves an early-stage acquisition to Offered.
  const { data: advanced } = await supabase
    .from("deals")
    .update({ stage: "offered" })
    .eq("id", params.id)
    .eq("deal_type", "acquisition")
    .in("stage", ["prospect", "uw"])
    .select("id");
  if (advanced && advanced.length > 0) {
    await logDealEvent(params.id, "marked_offered", { via: "offer_logged" }, "system");
  }

  return NextResponse.json({ offer }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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
