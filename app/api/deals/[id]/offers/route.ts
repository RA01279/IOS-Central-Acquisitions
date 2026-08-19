// app/api/deals/[id]/offers/route.ts
// Offer history for a deal -- the tracker's "Last Offer Date/Price" and
// "Times We've Offered" as real rows. The insert itself (plus the
// prospect/uw -> Offered advance) lives in recordOffer(), shared with LOI
// generation so an LOI at a price lands in the offer log automatically.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { logDealEvent, recordOffer } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
