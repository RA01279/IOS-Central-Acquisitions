// lib/weekly-report.ts
//
// The weekly pipeline report for leadership: where the pipeline stands (by
// class and stage, with value), what moved in the last 7 days (stage moves,
// new deals, offers, losses with reasons), closings MTD / YTD, what's coming
// in the next 14 days, and each owner's book. One model, rendered as the
// /reports/weekly page (print to PDF) and as an Excel download.

import { getServiceClient } from "./supabase";
import { fetchAll } from "./fetch-all";
import { ASSET_CLASS_LABELS, STAGE_LABELS } from "./deals";
import { addDays, assetClassOf, ctToday, dealValue } from "./summary";
import { OFFER_STATUS_LABELS } from "./offer-status";
import { listTeam, nameOf } from "./team";

const OPEN_STAGES = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence"] as const;
const MOVE_EVENTS: Record<string, string> = {
  deal_created: "New deal",
  advanced_to_uw: "To UW",
  marked_offered: "To Offered",
  confirmed_psa: "To Moving to PSA",
  entered_due_diligence: "To Due Diligence",
  marked_closed: "Closed",
  archived: "Archived",
  restored: "Restored",
  stage_corrected: "Stage corrected",
};

export type ReportDealRef = { id: string; address: string; assetClass: string; market: string | null; owner: string | null };
export type WeeklyReport = {
  today: string;
  weekStart: string;
  horizon: string;
  generatedAt: string;
  snapshot: { assetClass: string; label: string; stages: { stage: string; label: string; count: number; value: number }[]; total: { count: number; value: number } }[];
  closed: { mtd: { count: number; value: number }; ytd: { count: number; value: number } };
  moves: (ReportDealRef & { date: string; what: string; actor: string; detail: string | null })[];
  offers: (ReportDealRef & { date: string; price: number | null; status: string; counter: number | null })[];
  losses: (ReportDealRef & { date: string; stage: string; reason: string | null })[];
  upcoming: (ReportDealRef & { date: string; what: string })[];
  owners: { owner: string; active: number; value: number; inContract: number; due: number }[];
};

export async function buildWeeklyReport(): Promise<WeeklyReport> {
  const db = getServiceClient();
  const today = ctToday();
  const weekStart = addDays(today, -6);
  const horizon = addDays(today, 14);
  const since = `${weekStart}T00:00:00-06:00`;

  const [deals, events, offers, milestones, team] = await Promise.all([
    fetchAll((f, t) =>
      db.from("deals")
        .select("id, stage, asset_class, assigned_analyst, created_at, closed_on, closed_price, contract_price, dd_end_on, closing_on, ic_on, death_reason, properties(address, market), offers(price, offered_at)")
        .eq("deal_type", "acquisition").order("id").range(f, t)),
    fetchAll((f, t) =>
      db.from("deal_events").select("deal_id, event_type, detail, actor, created_at")
        .in("event_type", Object.keys(MOVE_EVENTS)).gte("created_at", since).order("created_at").range(f, t)),
    fetchAll((f, t) =>
      db.from("offers").select("deal_id, price, offered_at, status, counter_price").gte("offered_at", weekStart).order("offered_at").range(f, t)),
    fetchAll((f, t) =>
      db.from("deal_milestones").select("deal_id, label, due_on, key").is("done_on", null).gte("due_on", today).lte("due_on", horizon)
        .or("key.is.null,key.not.in.(dd_end,closing)").order("due_on").range(f, t)),
    listTeam(),
  ]);

  const byId = new Map(deals.map((d: any) => [d.id, d]));
  const ref = (id: string): ReportDealRef => {
    const d: any = byId.get(id) ?? {};
    return {
      id,
      address: d.properties?.address ?? "(deleted deal)",
      assetClass: ASSET_CLASS_LABELS[assetClassOf(d)] ?? "IOS",
      market: d.properties?.market ?? null,
      owner: nameOf(team, d.assigned_analyst),
    };
  };
  const value = (d: any) => dealValue(d).amount ?? 0;

  const snapshot = (["ios", "industrial"] as const).map((ac) => {
    const inClass = deals.filter((d: any) => assetClassOf(d) === ac);
    const stages = OPEN_STAGES.map((st) => {
      const list = inClass.filter((d: any) => d.stage === st);
      return { stage: st, label: STAGE_LABELS[st], count: list.length, value: list.reduce((t: number, d: any) => t + value(d), 0) };
    });
    return {
      assetClass: ac,
      label: ASSET_CLASS_LABELS[ac],
      stages,
      total: { count: stages.reduce((t, s) => t + s.count, 0), value: stages.reduce((t, s) => t + s.value, 0) },
    };
  });

  const closedSince = (start: string) => {
    const list = deals.filter((d: any) => d.stage === "closed" && d.closed_on && d.closed_on >= start);
    return { count: list.length, value: list.reduce((t: number, d: any) => t + value(d), 0) };
  };

  const moves = events
    .filter((e: any) => e.event_type !== "archived")
    .map((e: any) => ({
      ...ref(e.deal_id),
      date: String(e.created_at).slice(0, 10),
      what: MOVE_EVENTS[e.event_type] ?? e.event_type,
      actor: String(e.actor ?? "").split("@")[0],
      detail: e.event_type === "stage_corrected" && e.detail?.to ? `to ${STAGE_LABELS[e.detail.to] ?? e.detail.to}` : null,
    }));
  const losses = events
    .filter((e: any) => e.event_type === "archived")
    .map((e: any) => ({
      ...ref(e.deal_id),
      date: String(e.created_at).slice(0, 10),
      stage: STAGE_LABELS[e.detail?.stage] ?? e.detail?.stage ?? "—",
      reason: e.detail?.reason ?? (byId.get(e.deal_id) as any)?.death_reason ?? null,
    }));

  const upcoming: WeeklyReport["upcoming"] = [];
  for (const d of deals as any[]) {
    if (d.stage === "archived" || d.stage === "closed") continue;
    for (const [date, what] of [[d.dd_end_on, "DD expires"], [d.closing_on, "Closing"], [d.ic_on, "IC"]] as const) {
      if (date && date >= today && date <= horizon) upcoming.push({ ...ref(d.id), date, what });
    }
  }
  for (const m of milestones as any[]) {
    const d: any = byId.get(m.deal_id);
    if (!d || d.stage === "archived" || d.stage === "closed") continue;
    upcoming.push({ ...ref(m.deal_id), date: m.due_on, what: m.label });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const owners = new Map<string, WeeklyReport["owners"][number]>();
  for (const d of deals as any[]) {
    if (!(OPEN_STAGES as readonly string[]).includes(d.stage)) continue;
    const who = nameOf(team, d.assigned_analyst) ?? "Unassigned";
    const o = owners.get(who) ?? { owner: who, active: 0, value: 0, inContract: 0, due: 0 };
    o.active++;
    o.value += value(d);
    if (d.stage === "moving_to_psa" || d.stage === "due_diligence") o.inContract++;
    owners.set(who, o);
  }
  for (const u of upcoming) {
    const o = owners.get(u.owner ?? "Unassigned");
    if (o) o.due++;
  }

  return {
    today,
    weekStart,
    horizon,
    generatedAt: new Date().toISOString(),
    snapshot,
    closed: { mtd: closedSince(`${today.slice(0, 7)}-01`), ytd: closedSince(`${today.slice(0, 4)}-01-01`) },
    moves,
    offers: offers.map((o: any) => ({
      ...ref(o.deal_id),
      date: o.offered_at,
      price: o.price != null ? Number(o.price) : null,
      status: OFFER_STATUS_LABELS[o.status ?? "sent"] ?? o.status,
      counter: o.counter_price != null ? Number(o.counter_price) : null,
    })),
    losses,
    upcoming,
    owners: [...owners.values()].sort((a, b) => (a.owner === "Unassigned" ? 1 : b.owner === "Unassigned" ? -1 : b.active - a.active)),
  };
}
