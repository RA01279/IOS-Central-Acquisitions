// lib/diligence-db.ts
//
// Writes for the diligence schedule (lib/diligence.ts holds the template).
// The dd_end and closing milestones and deals.dd_end_on / closing_on are the
// same two dates; every write here keeps them equal.

import { getServiceClient } from "./supabase";
import { buildSchedule, parseDays } from "./diligence";
import { logDealEvent } from "./deals";

export const MILESTONE_COLUMNS = "id, deal_id, key, label, due_on, done_on, notes, sort_order, updated_at";

export async function listMilestones(dealId: string) {
  const { data, error } = await getServiceClient()
    .from("deal_milestones")
    .select(MILESTONE_COLUMNS)
    .eq("deal_id", dealId)
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("sort_order");
  if (error) throw new Error(`Loading milestones: ${error.message}`);
  return data ?? [];
}

/**
 * Create the standard schedule from the PSA effective date. Missing rows are
 * added; with `recalc`, open template rows move to the recalculated dates
 * (done ones and hand-added ones are never touched). An explicit DD expiry or
 * closing date wins over the computed one.
 */
export async function generateSchedule(
  dealId: string,
  input: {
    psaEffectiveOn: string;
    ddDays?: unknown;
    closingDays?: unknown;
    ddEndOn?: string | null;
    closingOn?: string | null;
    recalc?: boolean;
  },
  actor: string
) {
  const db = getServiceClient();
  const { data: deal, error } = await db
    .from("deals")
    .select("id, loi_terms, dd_end_on, closing_on, properties(occupancy_status)")
    .eq("id", dealId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!deal) throw new Error("Deal not found");
  const terms = (deal.loi_terms ?? {}) as Record<string, unknown>;
  const occupied = ((deal as any).properties?.occupancy_status ?? null) === "occupied";
  const rows = buildSchedule({
    psaEffectiveOn: input.psaEffectiveOn,
    ddDays: parseDays(input.ddDays) ?? parseDays(terms.ddDays),
    closingDays: parseDays(input.closingDays) ?? parseDays(terms.closingDays),
    occupied,
  });
  for (const r of rows) {
    if (r.key === "dd_end" && input.ddEndOn) r.due_on = input.ddEndOn;
    if (r.key === "closing" && input.closingOn) r.due_on = input.closingOn;
  }

  const { data: existing, error: exError } = await db
    .from("deal_milestones")
    .select("id, key, done_on")
    .eq("deal_id", dealId)
    .not("key", "is", null);
  if (exError) throw new Error(exError.message);
  const byKey = new Map((existing ?? []).map((e: any) => [e.key, e]));

  const inserts = rows.filter((r) => !byKey.has(r.key)).map((r) => ({ ...r, deal_id: dealId, created_by: actor }));
  if (inserts.length) {
    const { error: insError } = await db.from("deal_milestones").insert(inserts);
    if (insError) throw new Error(`Saving the schedule: ${insError.message}`);
  }
  if (input.recalc) {
    for (const r of rows) {
      const e: any = byKey.get(r.key);
      if (!e || e.done_on) continue;
      const { error: upError } = await db
        .from("deal_milestones")
        .update({ due_on: r.due_on, updated_at: new Date().toISOString() })
        .eq("id", e.id);
      if (upError) throw new Error(upError.message);
    }
  }

  const ddEnd = rows.find((r) => r.key === "dd_end")!.due_on;
  const closing = rows.find((r) => r.key === "closing")!.due_on;
  // A recalculation moves the deal's dates too; a first-time generate only
  // fills them when they're blank, so dates already on the deal are kept.
  const dealUpdate: Record<string, unknown> = { psa_effective_on: input.psaEffectiveOn };
  if (input.recalc || !deal.dd_end_on || input.ddEndOn) dealUpdate.dd_end_on = ddEnd;
  if (input.recalc || !deal.closing_on || input.closingOn) dealUpdate.closing_on = closing;
  const { error: dealError } = await db.from("deals").update(dealUpdate).eq("id", dealId);
  if (dealError) throw new Error(dealError.message);
  // ...and the two milestone rows follow whatever the deal ended up with.
  await syncDealDates(dealId);

  await logDealEvent(dealId, input.recalc ? "diligence_recalculated" : "diligence_scheduled",
    { psa_effective_on: input.psaEffectiveOn, added: inserts.length }, actor);
  return { added: inserts.length };
}

/** Copy deals.dd_end_on / closing_on onto the open dd_end / closing milestones. */
export async function syncDealDates(dealId: string) {
  const db = getServiceClient();
  const { data: deal } = await db.from("deals").select("dd_end_on, closing_on").eq("id", dealId).maybeSingle();
  if (!deal) return;
  for (const [key, date] of [["dd_end", deal.dd_end_on], ["closing", deal.closing_on]] as const) {
    const { error } = await db
      .from("deal_milestones")
      .update({ due_on: date ?? null, updated_at: new Date().toISOString() })
      .eq("deal_id", dealId)
      .eq("key", key)
      .is("done_on", null);
    if (error) throw new Error(error.message);
  }
}
