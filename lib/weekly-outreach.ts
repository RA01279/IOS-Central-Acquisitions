// lib/weekly-outreach.ts
//
// The weekly report's off-market outreach section (app/reports/weekly):
//   * byPerson -- each person's owner touches this week (calls, emails,
//     letters, other), how many reached an owner, and their overdue
//     follow-ups;
//   * warm     -- sites still in Outreach whose owner is interested or talking,
//     with the latest touch and the next one;
//   * moved    -- sites that went from Outreach into the pipeline this week;
//   * parked   -- sites parked as targets from Outreach this week (owner not
//     selling), with when to check back. These are not pipeline losses.
// buildWeeklyOutreach is pure; loadWeeklyOutreach does the queries.

import { getServiceClient } from "./supabase";
import { fetchAll } from "./fetch-all";
import { OUTCOME_LABELS, TOUCH_LABELS, outreachStatus, STATUS_LABELS, type OutreachStatus } from "./outreach";

export type WeeklyOutreach = {
  byPerson: { person: string; touches: number; calls: number; emails: number; letters: number; other: number; reached: number; overdue: number }[];
  warm: { id: string; address: string; city: string | null; owner: string | null; status: OutreachStatus; statusLabel: string; lastTouch: { what: string; on: string; note: string | null } | null; nextOn: string | null }[];
  moved: { id: string; address: string; on: string; by: string }[];
  parked: { id: string; address: string; on: string; reason: string | null; checkBackOn: string | null }[];
  totals: { touches: number; reached: number; overdue: number };
};

type Touch = { deal_id: string; activity_type: string; outcome: string | null; occurred_at: string; created_by: string; body: string | null };
type OutreachDeal = { id: string; address: string; city: string | null; owner: string | null };
type Task = { deal_id: string; assigned_to: string | null; due_date: string };
type Event = { deal_id: string; event_type: string; created_at: string; actor: string | null; detail: any };

const ctDay = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function buildWeeklyOutreach(input: {
  weekStart: string;
  today: string;
  /** Deals in the Outreach stage now. */
  outreachDeals: OutreachDeal[];
  /** Every owner touch (activities with an outcome, or on an Outreach deal), newest first. */
  touches: Touch[];
  /** Open outreach reminders. */
  reminders: Task[];
  /** moved_to_pipeline and archived events from this week. */
  events: Event[];
  /** Address and follow-up date of deals named by events. */
  dealInfo: Map<string, { address: string; followUpOn: string | null }>;
  nameOf: (email: string | null) => string;
}): WeeklyOutreach {
  const { weekStart, today } = input;
  const touches = input.touches.filter((t) => ctDay(t.occurred_at) <= today)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const week = touches.filter((t) => ctDay(t.occurred_at) >= weekStart);
  const events = input.events.filter((e) => ctDay(e.created_at) >= weekStart && ctDay(e.created_at) <= today);
  const people = new Map<string, WeeklyOutreach["byPerson"][number]>();
  const row = (person: string) => {
    if (!people.has(person)) people.set(person, { person, touches: 0, calls: 0, emails: 0, letters: 0, other: 0, reached: 0, overdue: 0 });
    return people.get(person)!;
  };
  for (const t of week) {
    const r = row(input.nameOf(t.created_by));
    r.touches++;
    if (t.activity_type === "call") r.calls++;
    else if (t.activity_type === "email") r.emails++;
    else if (t.activity_type === "letter") r.letters++;
    else r.other++;
    if (t.outcome === "spoke" || t.outcome === "interested") r.reached++;
  }
  for (const task of input.reminders) if (task.due_date < today) row(input.nameOf(task.assigned_to)).overdue++;

  const byDeal = new Map<string, Touch[]>();
  for (const t of touches) { const l = byDeal.get(t.deal_id) ?? []; l.push(t); byDeal.set(t.deal_id, l); }
  const nextOn = new Map<string, string>();
  for (const task of input.reminders) if (!nextOn.has(task.deal_id) || task.due_date < nextOn.get(task.deal_id)!) nextOn.set(task.deal_id, task.due_date);
  const warm = input.outreachDeals
    .map((d) => {
      const touches = byDeal.get(d.id) ?? [];
      const status = outreachStatus(touches);
      const last = touches[0];
      return {
        id: d.id, address: d.address, city: d.city, owner: d.owner, status, statusLabel: STATUS_LABELS[status],
        lastTouch: last ? { what: [TOUCH_LABELS[last.activity_type] ?? last.activity_type, last.outcome ? OUTCOME_LABELS[last.outcome] ?? last.outcome : null].filter(Boolean).join(" · "), on: ctDay(last.occurred_at), note: last.body ? last.body.slice(0, 240) : null } : null,
        nextOn: nextOn.get(d.id) ?? null,
      };
    })
    .filter((w) => w.status === "interested" || w.status === "talking")
    .sort((a, b) => (a.status === b.status ? (b.lastTouch?.on ?? "").localeCompare(a.lastTouch?.on ?? "") : a.status === "interested" ? -1 : 1));

  const info = (id: string) => input.dealInfo.get(id);
  const moved = events.filter((e) => e.event_type === "moved_to_pipeline")
    .map((e) => ({ id: e.deal_id, address: info(e.deal_id)?.address ?? "Deal", on: ctDay(e.created_at), by: input.nameOf(e.actor) }));
  const parked = events.filter((e) => e.event_type === "archived" && e.detail?.stage === "outreach")
    .map((e) => ({ id: e.deal_id, address: info(e.deal_id)?.address ?? "Deal", on: ctDay(e.created_at), reason: e.detail?.reason ?? null, checkBackOn: e.detail?.follow_up ?? info(e.deal_id)?.followUpOn ?? null }));

  const byPerson = [...people.values()].sort((a, b) => b.touches - a.touches || b.overdue - a.overdue);
  return {
    byPerson, warm, moved, parked,
    totals: { touches: week.length, reached: week.filter((t) => t.outcome === "spoke" || t.outcome === "interested").length, overdue: input.reminders.filter((t) => t.due_date < today).length },
  };
}

export async function loadWeeklyOutreach(weekStart: string, today: string, nameOf: (email: string | null) => string): Promise<WeeklyOutreach> {
  const db = getServiceClient();
  // Start conservatively in UTC; the builder applies Chicago calendar boundaries,
  // including daylight saving time.
  const since = `${weekStart}T00:00:00Z`;
  const [deals, reminders, events] = await Promise.all([
    fetchAll((f, t) => db.from("deals").select("id, stage, follow_up_on, properties(address, city), deal_contacts(role, contacts(name))").eq("deal_type", "acquisition").order("id").range(f, t)),
    fetchAll((f, t) => db.from("tasks").select("deal_id, assigned_to, due_date").eq("kind", "outreach").eq("status", "open").not("due_date", "is", null).order("id").range(f, t)),
    fetchAll((f, t) => db.from("deal_events").select("deal_id, event_type, created_at, actor, detail").in("event_type", ["moved_to_pipeline", "archived"]).gte("created_at", since).order("created_at").order("id").range(f, t)),
  ]);
  const outreachDeals = deals.filter((d: any) => d.stage === "outreach");
  const acquisitionIds = new Set(deals.map((d: any) => d.id));
  const outreachIds = new Set(outreachDeals.map((d: any) => d.id));
  // Owner touches: anything logged with an outcome (the touch form), plus touches on deals in Outreach.
  const touches = (await fetchAll((f, t) => db.from("activities").select("deal_id, activity_type, outcome, occurred_at, created_by, body")
    .not("deal_id", "is", null).in("activity_type", ["call", "email", "letter", "text", "site_visit", "meeting"])
    .order("occurred_at", { ascending: false }).order("id").range(f, t)))
    .filter((a: any) => acquisitionIds.has(a.deal_id) && (a.outcome || outreachIds.has(a.deal_id))) as Touch[];
  return buildWeeklyOutreach({
    weekStart, today, touches, reminders: reminders.filter((t: any) => outreachIds.has(t.deal_id)) as Task[],
    events: events.filter((e: any) => acquisitionIds.has(e.deal_id)) as Event[], nameOf,
    outreachDeals: outreachDeals.map((d: any) => ({ id: d.id, address: d.properties?.address ?? "Untitled", city: d.properties?.city ?? null, owner: d.deal_contacts?.find((l: any) => l.role === "seller")?.contacts?.name ?? null })),
    dealInfo: new Map(deals.map((d: any) => [d.id, { address: d.properties?.address ?? "Deal", followUpOn: d.follow_up_on ?? null }])),
  });
}
