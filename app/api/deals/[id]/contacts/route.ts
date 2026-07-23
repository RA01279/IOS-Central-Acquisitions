// app/api/deals/[id]/contacts/route.ts
// Link/unlink contacts on a deal, with the role they play on it.
import { NextRequest, NextResponse } from "next/server";
import { linkContactToDeal, unlinkContactFromDeal } from "@/lib/crm";
import { logDealEvent } from "@/lib/deals";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.contactId || !body.role) {
    return NextResponse.json({ error: "contactId and role are required" }, { status: 400 });
  }

  try {
    const link = await linkContactToDeal({
      dealId: params.id,
      contactId: body.contactId,
      role: body.role,
    });
    await logDealEvent(params.id, "contact_linked", { contact_id: body.contactId, role: body.role }, user.email);
    return NextResponse.json({ link }, { status: 201 });
  } catch (err: any) {
    // 23505 = unique violation: same contact already linked in this role.
    if (err?.code === "23505") {
      return NextResponse.json({ error: "That contact is already on the deal in this role" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.linkId) return NextResponse.json({ error: "linkId is required" }, { status: 400 });

  try {
    await unlinkContactFromDeal(body.linkId);
    await logDealEvent(params.id, "contact_unlinked", { link_id: body.linkId }, user.email);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
