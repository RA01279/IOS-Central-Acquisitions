// app/api/deals/[id]/milestones/route.ts
//
// POST  { action: "generate", psaEffectiveOn, ddDays?, closingDays?, recalc? }
//       { action: "add", label, dueOn? }
// PATCH { milestoneId, dueOn?, doneOn?, notes?, label? }
// DELETE { milestoneId }
//
// Editing the dd_end or closing milestone moves the deal's dd_end_on /
// closing_on with it -- they are one date shown in two places.
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { logDealEvent } from "@/lib/deals";
import { validDate } from "@/lib/stage-rules";
import { generateSchedule } from "@/lib/diligence-db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEAL_DATE: Record<string, string> = { dd_end: "dd_end_on", closing: "closing_on" };

function dateOrNull(v: unknown, label: string): string | null {
  if (v == null || v === "") return null;
  if (!validDate(v)) throw new Error(`${label}: enter a valid date`);
  return v as string;
}

async function dealExists(id: string) {
  if (!UUID.test(id)) return false;
  const { data } = await getServiceClient().from("deals").select("id").eq("id", id).maybeSingle();
  return !!data;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await dealExists(id))) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "generate") {
      const psa = dateOrNull(body.psaEffectiveOn, "PSA effective date");
      if (!psa) return NextResponse.json({ error: "Enter the PSA effective date" }, { status: 400 });
      const result = await generateSchedule(
        id,
        { psaEffectiveOn: psa, ddDays: body.ddDays, closingDays: body.closingDays, recalc: body.recalc === true },
        user.email
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "add") {
      const label = String(body.label ?? "").trim();
      if (!label || label.length > 200) return NextResponse.json({ error: "Name the milestone (up to 200 characters)" }, { status: 400 });
      const dueOn = dateOrNull(body.dueOn, "Due date");
      const { data, error } = await getServiceClient()
        .from("deal_milestones")
        .insert({ deal_id: id, key: null, label, due_on: dueOn, sort_order: 1000, created_by: user.email })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logDealEvent(id, "milestone_added", { label, due_on: dueOn }, user.email);
      return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.milestoneId ?? ""))) return NextResponse.json({ error: "Missing milestone" }, { status: 400 });
  const db = getServiceClient();
  const { data: m } = await db
    .from("deal_milestones")
    .select("id, key, label, due_on, done_on")
    .eq("id", body.milestoneId)
    .eq("deal_id", id)
    .maybeSingle();
  if (!m) return NextResponse.json({ error: "Milestone not found on this deal" }, { status: 404 });

  const update: Record<string, unknown> = {};
  try {
    if ("dueOn" in body) update.due_on = dateOrNull(body.dueOn, "Due date");
    if ("doneOn" in body) update.done_on = dateOrNull(body.doneOn, "Done date");
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if ("notes" in body) {
    const notes = String(body.notes ?? "").trim();
    if (notes.length > 2000) return NextResponse.json({ error: "Notes are limited to 2,000 characters" }, { status: 400 });
    update.notes = notes || null;
  }
  if ("label" in body) {
    const label = String(body.label ?? "").trim();
    if (!label || label.length > 200) return NextResponse.json({ error: "Name the milestone (up to 200 characters)" }, { status: 400 });
    update.label = label;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  update.updated_at = new Date().toISOString();

  const { error } = await db.from("deal_milestones").update(update).eq("id", m.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // DD expiry and closing are also the deal's own dates.
  if (m.key && DEAL_DATE[m.key] && "due_on" in update) {
    const { error: dealError } = await db.from("deals").update({ [DEAL_DATE[m.key]]: update.due_on }).eq("id", id);
    if (dealError) return NextResponse.json({ error: `Saved, but the deal's date didn't update: ${dealError.message}` }, { status: 500 });
  }
  if ("done_on" in update && update.done_on && !m.done_on) {
    await logDealEvent(id, "milestone_done", { label: m.label, done_on: update.done_on }, user.email);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.milestoneId ?? ""))) return NextResponse.json({ error: "Missing milestone" }, { status: 400 });
  const db = getServiceClient();
  const { data: m } = await db.from("deal_milestones").select("id, key, label").eq("id", body.milestoneId).eq("deal_id", id).maybeSingle();
  if (!m) return NextResponse.json({ error: "Milestone not found on this deal" }, { status: 404 });
  // The deal's own DD and closing dates can be cleared, not deleted.
  if (m.key && DEAL_DATE[m.key]) return NextResponse.json({ error: "DD expiry and closing can't be removed; clear the date instead" }, { status: 400 });
  const { error } = await db.from("deal_milestones").delete().eq("id", m.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logDealEvent(id, "milestone_removed", { label: m.label }, user.email);
  return NextResponse.json({ ok: true });
}
