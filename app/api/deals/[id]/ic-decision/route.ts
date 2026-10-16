// app/api/deals/[id]/ic-decision/route.ts
//
// POST   { decidedOn, outcome, approvedPrice?, conditions?, notes? } -- record an IC outcome
// DELETE { decisionId }                                               -- remove one entered in error
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { logDealEvent } from "@/lib/deals";
import { parseMoney } from "@/lib/money";
import { validDate } from "@/lib/stage-rules";
import { IC_OUTCOMES, IC_OUTCOME_LABELS } from "@/lib/ic-decisions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  if (s.length > max) throw new Error(`Keep it under ${max.toLocaleString()} characters`);
  return s || null;
};

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (!(IC_OUTCOMES as readonly string[]).includes(body.outcome)) return NextResponse.json({ error: "Choose the IC outcome" }, { status: 400 });
  if (!validDate(body.decidedOn)) return NextResponse.json({ error: "Enter the IC date" }, { status: 400 });
  let row: Record<string, unknown>;
  try {
    row = {
      deal_id: id,
      decided_on: body.decidedOn,
      outcome: body.outcome,
      approved_price: parseMoney(body.approvedPrice),
      conditions: text(body.conditions, 4000),
      notes: text(body.notes, 4000),
      created_by: user.email,
    };
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  const db = getServiceClient();
  const { data: deal } = await db.from("deals").select("id").eq("id", id).maybeSingle();
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const { data, error } = await db.from("ic_decisions").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The IC date on the deal follows the sitting that decided it.
  await db.from("deals").update({ ic_on: body.decidedOn }).eq("id", id);
  await logDealEvent(id, "ic_decision", { outcome: IC_OUTCOME_LABELS[body.outcome], approved_price: row.approved_price, decided_on: body.decidedOn }, user.email);
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.decisionId ?? ""))) return NextResponse.json({ error: "Missing decision" }, { status: 400 });
  const { data, error } = await getServiceClient().from("ic_decisions").delete().eq("id", body.decisionId).eq("deal_id", id).select("outcome, decided_on");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Decision not found on this deal" }, { status: 404 });
  await logDealEvent(id, "ic_decision_removed", { outcome: data[0].outcome, decided_on: data[0].decided_on }, user.email);
  return NextResponse.json({ ok: true });
}
