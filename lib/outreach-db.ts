// lib/outreach-db.ts
//
// The DB side of off-market owner outreach (rules in lib/outreach.ts):
//   logTouch      -- records a call / email / letter... on the deal, and
//                    replaces the deal's one "next touch" reminder task
//   loadOutreach  -- every open off-market prospect with its owner, touches,
//                    status and next follow-up, for the Outreach page
// A touch is an ordinary activity (it shows in the deal's history and the
// contact's), and the reminder an ordinary task (Tasks page, morning brief),
// marked kind='outreach' so there is only ever one per deal.

import { getServiceClient } from "./supabase";
import { fetchAll } from "./fetch-all";
import { outreachStatus, OUTCOME_LABELS, TOUCH_LABELS, type OutreachStatus, type Outcome, type TouchType } from "./outreach";

export type TouchInput = { type: TouchType; outcome: Outcome | null; note: string | null; occurredOn: string; nextOn: string | null; contactId: string | null };

export async function logTouch(dealId: string, input: TouchInput, actor: string, today: string): Promise<{ activityId: string; taskId: string | null }> {
  const db = getServiceClient();
  const { data: deal, error: dealError } = await db
    .from("deals").select("id, property_id, assigned_analyst, properties(address), deal_contacts(role, contact_id)").eq("id", dealId).maybeSingle();
  if (dealError) throw dealError;
  if (!deal) throw Object.assign(new Error("Deal not found"), { status: 404 });
  // The owner we reached, unless the form named someone else.
  const contactId = input.contactId ?? (deal as any).deal_contacts?.find((l: any) => l.role === "seller")?.contact_id ?? null;
  const address = (deal as any).properties?.address ?? "this property";

  // Today's touches carry the time they were logged; back-dated ones sit at noon CT.
  const occurredAt = input.occurredOn === today ? new Date().toISOString() : `${input.occurredOn}T12:00:00-06:00`;
  const { data: activity, error } = await db.from("activities").insert({
    activity_type: input.type,
    outcome: input.outcome,
    subject: [TOUCH_LABELS[input.type], input.outcome ? OUTCOME_LABELS[input.outcome] : null].filter(Boolean).join(" · "),
    body: input.note,
    occurred_at: occurredAt,
    deal_id: dealId,
    contact_id: contactId,
    property_id: (deal as any).property_id ?? null,
    created_by: actor,
  }).select("id").single();
  if (error) throw error;

  // One next step per prospect: the old reminder closes, a new one (if any) opens.
  const { error: closeError } = await db.from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("deal_id", dealId).eq("kind", "outreach").eq("status", "open");
  if (closeError) throw closeError;
  let taskId: string | null = null;
  if (input.nextOn) {
    const { data: task, error: taskError } = await db.from("tasks").insert({
      title: `Follow up with the owner: ${address}`,
      notes: `Last touch: ${[TOUCH_LABELS[input.type], input.outcome ? OUTCOME_LABELS[input.outcome].toLowerCase() : null].filter(Boolean).join(", ")}${input.note ? ` — ${input.note.slice(0, 200)}` : ""}`,
      due_date: input.nextOn,
      kind: "outreach",
      deal_id: dealId,
      contact_id: contactId,
      assigned_to: actor,
      created_by: actor,
    }).select("id").single();
    if (taskError) throw taskError;
    taskId = task.id;
  }
  const { error: dealUpdateError } = await db.from("deals").update({ follow_up_on: input.nextOn }).eq("id", dealId);
  if (dealUpdateError) throw dealUpdateError;
  return { activityId: activity.id, taskId };
}

export type OutreachTouch = { id: string; activity_type: string; outcome: string | null; occurred_at: string; body: string | null; created_by: string };
export type OutreachRow = {
  dealId: string;
  stage: string;
  address: string;
  city: string | null;
  market: string | null;
  acres: number | null;
  addedOn: string;
  owner: { id: string; name: string; phone: string | null; email: string | null } | null;
  assignedTo: string | null;
  touches: OutreachTouch[];
  status: OutreachStatus;
  nextOn: string | null;
  nextBy: string | null;
};

/** Open off-market prospects (not archived or closed), with their outreach. */
export async function loadOutreach(): Promise<OutreachRow[]> {
  const db = getServiceClient();
  const deals = await fetchAll((f, t) =>
    db.from("deals")
      .select("id, stage, created_at, assigned_analyst, follow_up_on, properties(address, city, market, lot_sf), deal_contacts(role, contacts(id, name, phone, email))")
      .eq("deal_type", "acquisition").eq("marketing_status", "off_market").not("stage", "in", "(archived,closed)")
      .order("id").range(f, t));
  if (!deals.length) return [];
  const ids = new Set(deals.map((d: any) => d.id));
  const [activities, tasks] = await Promise.all([
    fetchAll((f, t) => db.from("activities").select("id, deal_id, activity_type, outcome, occurred_at, body, created_by")
      .not("deal_id", "is", null).neq("activity_type", "note").order("occurred_at", { ascending: false }).order("id").range(f, t)),
    fetchAll((f, t) => db.from("tasks").select("deal_id, due_date, assigned_to").eq("kind", "outreach").eq("status", "open").order("id").range(f, t)),
  ]);
  const byDeal = new Map<string, OutreachTouch[]>();
  for (const a of activities as any[]) {
    if (!ids.has(a.deal_id)) continue;
    const list = byDeal.get(a.deal_id) ?? [];
    list.push(a);
    byDeal.set(a.deal_id, list);
  }
  const next = new Map((tasks as any[]).filter((t) => ids.has(t.deal_id)).map((t) => [t.deal_id, t]));
  return deals.map((d: any) => {
    const touches = byDeal.get(d.id) ?? [];
    const seller = d.deal_contacts?.find((l: any) => l.role === "seller")?.contacts ?? null;
    const task = next.get(d.id);
    return {
      dealId: d.id,
      stage: d.stage,
      address: d.properties?.address ?? "Untitled",
      city: d.properties?.city ?? null,
      market: d.properties?.market ?? null,
      acres: d.properties?.lot_sf ? Number(d.properties.lot_sf) / 43560 : null,
      addedOn: String(d.created_at).slice(0, 10),
      owner: seller ? { id: seller.id, name: seller.name, phone: seller.phone ?? null, email: seller.email ?? null } : null,
      assignedTo: d.assigned_analyst ?? null,
      touches,
      status: outreachStatus(touches),
      // The reminder task is the source of truth; a follow-up date set elsewhere on the deal counts too.
      nextOn: task?.due_date ?? d.follow_up_on ?? null,
      nextBy: task?.assigned_to ?? null,
    };
  });
}
