// app/api/deals/[id]/outreach/route.ts
//
// POST { type, outcome?, note?, occurredOn?, nextOn?, contactId? }
//   -> logs one owner-outreach touch on the deal and sets its next follow-up
//      (lib/outreach-db.ts logTouch). nextOn null means no further reminder.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ctToday } from "@/lib/summary";
import { parseTouch } from "@/lib/outreach";
import { logTouch } from "@/lib/outreach-db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown deal" }, { status: 404 });
  const today = ctToday();
  const touch = parseTouch(await req.json().catch(() => null), today);
  if (!touch.ok) return NextResponse.json({ error: touch.error }, { status: 400 });
  try {
    const out = await logTouch(id, touch, user.email, today);
    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not log the touch" }, { status: err.status ?? 500 });
  }
}
