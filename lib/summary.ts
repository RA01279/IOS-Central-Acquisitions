// lib/summary.ts
//
// The numbers the home screen shows, computed once here so the home screen,
// the export API, and the morning brief can't drift into three different
// answers for "how many offers did we submit this month".
//
// Everything is date-bucketed in America/Chicago, not UTC. That matters: a
// deal entered at 7pm CT is "today" to the team but tomorrow in UTC, and
// counting it in the wrong day makes the Last-7-days tile disagree with what
// people remember doing. Postgres `date` columns (offered_at, closed_on,
// dd_end_on, closing_on) are already calendar dates and compare directly as
// strings; timestamptz columns (created_at) get converted with ctDate().

import { getServiceClient } from "./supabase";
import { IN_CONTRACT_STAGES, type AssetClass } from "./deals";

const TZ = "America/Chicago";

export const RANGE_KEYS = ["7d", "mtd", "ytd"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  mtd: "Month to date",
  ytd: "Year to date",
};

export function isRangeKey(v: string | undefined | null): v is RangeKey {
  return !!v && (RANGE_KEYS as readonly string[]).includes(v);
}

// Today's calendar date in CT, as YYYY-MM-DD. en-CA formats as ISO.
export function ctToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

// The CT calendar date a timestamp falls on.
export function ctDate(ts: string | Date | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: TZ });
}

// Date-string arithmetic via UTC noon, which is immune to DST edges.
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

// Inclusive start date for a range. "Last 7 days" includes today, so it starts
// 6 days back -- seven calendar days total, which is what someone comparing
// against a weekly rhythm expects.
export function rangeStart(range: RangeKey, today: string = ctToday()): string {
  if (range === "7d") return addDays(today, -6);
  if (range === "mtd") return `${today.slice(0, 7)}-01`;
  return `${today.slice(0, 4)}-01-01`;
}

// -- Shapes ---------------------------------------------------------------

export interface ClassSplit {
  ios: number;
  industrial: number;
  total: number;
}

export interface SummaryDeal {
  id: string;
  address: string | null;
  market: string | null;
  assetClass: AssetClass;
  stage: string;
  value: number | null;
  ddEndOn: string | null;
  closingOn: string | null;
  closedOn: string | null;
}

export type MilestoneKind = "dd_end" | "closing";

export interface Milestone {
  dealId: string;
  address: string | null;
  assetClass: AssetClass;
  stage: string;
  kind: MilestoneKind;
  date: string;
  daysAway: number; // negative = already past
}

export interface Summary {
  range: RangeKey;
  rangeStart: string;
  today: string;
  // Range-scoped activity: what happened during the window.
  newProspects: ClassSplit;
  underwritten: ClassSplit;
  offersSubmitted: ClassSplit;
  offersValue: ClassSplit;
  // Point-in-time standing counts: what's sitting in each stage right now.
  // Not range-scoped -- a stage count has no date window.
  standing: Record<"prospect" | "uw" | "offered", ClassSplit>;
  inContract: { count: ClassSplit; value: ClassSplit; deals: SummaryDeal[] };
  closed: { count: ClassSplit; value: ClassSplit; deals: SummaryDeal[] };
  upcoming: Milestone[];
}

// -- Helpers ---------------------------------------------------------------

function emptySplit(): ClassSplit {
  return { ios: 0, industrial: 0, total: 0 };
}

function addToSplit(split: ClassSplit, assetClass: AssetClass, amount = 1): void {
  split[assetClass] += amount;
  split.total += amount;
}

export function assetClassOf(deal: any): AssetClass {
  return deal?.asset_class === "industrial" ? "industrial" : "ios";
}

// A deal's dollar value for roll-up purposes: its most recent offer. That's the
// only price Hopper actually holds -- there is no contract-price field -- so
// every "$" on the home screen is last-offer money and is labelled that way.
export function lastOffer(deal: any): { price: number | null; offeredAt: string | null } {
  const sorted = [...(deal?.offers ?? [])].sort((a: any, b: any) =>
    (b.offered_at ?? "").localeCompare(a.offered_at ?? "")
  );
  return { price: sorted[0]?.price ?? null, offeredAt: sorted[0]?.offered_at ?? null };
}

// The date a closed deal closed. closed_on is set when the Closed button is
// used; the updated_at fallback covers a row whose stage was changed directly
// in the database, so a closing never silently drops out of the totals.
export function closedDate(deal: any): string {
  return deal?.closed_on ?? ctDate(deal?.updated_at ?? deal?.created_at);
}

function summaryDeal(deal: any): SummaryDeal {
  return {
    id: deal.id,
    address: deal.properties?.address ?? null,
    market: deal.properties?.market ?? null,
    assetClass: assetClassOf(deal),
    stage: deal.stage,
    value: lastOffer(deal).price,
    ddEndOn: deal.dd_end_on ?? null,
    closingOn: deal.closing_on ?? null,
    closedOn: deal.closed_on ?? null,
  };
}

// DD expirations and closings landing within `withinDays`, plus anything
// already past that hasn't been moved along -- an overdue closing is more
// urgent than an upcoming one, never less, so it stays on the list.
export function upcomingMilestones(
  deals: any[],
  opts: { today?: string; withinDays?: number } = {}
): Milestone[] {
  const today = opts.today ?? ctToday();
  const withinDays = opts.withinDays ?? 7;
  const horizon = addDays(today, withinDays);
  const out: Milestone[] = [];

  for (const d of deals) {
    // Closed and archived deals have no live milestones left.
    if (d.stage === "archived" || d.stage === "closed") continue;
    const pairs: [MilestoneKind, string | null][] = [
      ["dd_end", d.dd_end_on ?? null],
      ["closing", d.closing_on ?? null],
    ];
    for (const [kind, date] of pairs) {
      if (!date || date > horizon) continue;
      out.push({
        dealId: d.id,
        address: d.properties?.address ?? null,
        assetClass: assetClassOf(d),
        stage: d.stage,
        kind,
        date,
        daysAway: daysBetween(today, date),
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const MILESTONE_LABELS: Record<MilestoneKind, string> = {
  dd_end: "DD expires",
  closing: "Closing",
};

// -- The one aggregate query ------------------------------------------------

export async function buildSummary(range: RangeKey): Promise<Summary> {
  const supabase = getServiceClient();
  const today = ctToday();
  const start = rangeStart(range, today);

  const [dealsRes, uwEventsRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, stage, asset_class, created_at, updated_at, dd_end_on, closing_on, closed_on, properties(address, market), offers(price, offered_at)"
      )
      .eq("deal_type", "acquisition"),
    // "Deals underwritten" = deals that entered UW in the window. The event
    // trail is the only place that's recorded; a deal now sitting at Offered
    // was still underwritten this month. The gte() is a coarse prefilter (it
    // compares a timestamptz against midnight UTC); ctDate() below does the
    // exact CT-calendar comparison.
    supabase
      .from("deal_events")
      .select("deal_id, event_type, detail, created_at")
      .in("event_type", ["advanced_to_uw", "stage_corrected"])
      .gte("created_at", addDays(start, -1)),
  ]);

  const deals = (dealsRes.data ?? []) as any[];
  const byId = new Map(deals.map((d) => [d.id, d]));

  const summary: Summary = {
    range,
    rangeStart: start,
    today,
    newProspects: emptySplit(),
    underwritten: emptySplit(),
    offersSubmitted: emptySplit(),
    offersValue: emptySplit(),
    standing: { prospect: emptySplit(), uw: emptySplit(), offered: emptySplit() },
    inContract: { count: emptySplit(), value: emptySplit(), deals: [] },
    closed: { count: emptySplit(), value: emptySplit(), deals: [] },
    upcoming: upcomingMilestones(deals, { today }),
  };

  for (const d of deals) {
    const ac = assetClassOf(d);

    if (ctDate(d.created_at) >= start) addToSplit(summary.newProspects, ac);

    if (d.stage === "prospect") addToSplit(summary.standing.prospect, ac);
    else if (d.stage === "uw" || d.stage === "uw_v1") addToSplit(summary.standing.uw, ac);
    else if (d.stage === "offered") addToSplit(summary.standing.offered, ac);

    if ((IN_CONTRACT_STAGES as readonly string[]).includes(d.stage)) {
      addToSplit(summary.inContract.count, ac);
      const { price } = lastOffer(d);
      if (price) addToSplit(summary.inContract.value, ac, price);
      summary.inContract.deals.push(summaryDeal(d));
    }

    if (d.stage === "closed" && closedDate(d) >= start) {
      addToSplit(summary.closed.count, ac);
      const { price } = lastOffer(d);
      if (price) addToSplit(summary.closed.value, ac, price);
      summary.closed.deals.push(summaryDeal(d));
    }

    // Offers submitted in the window, counted against the deal's asset class.
    // offered_at is a date column, so it compares directly against `start`.
    for (const o of d.offers ?? []) {
      if (!o.offered_at || o.offered_at < start) continue;
      addToSplit(summary.offersSubmitted, ac);
      if (o.price) addToSplit(summary.offersValue, ac, o.price);
    }
  }

  // Distinct deals that entered UW in the window (a deal corrected back and
  // forth shouldn't count twice).
  const uwDealIds = new Set<string>();
  for (const e of (uwEventsRes.data ?? []) as any[]) {
    if (ctDate(e.created_at) < start) continue;
    if (e.event_type === "stage_corrected" && e.detail?.to !== "uw") continue;
    if (byId.has(e.deal_id)) uwDealIds.add(e.deal_id);
  }
  for (const id of uwDealIds) {
    addToSplit(summary.underwritten, assetClassOf(byId.get(id)));
  }

  summary.inContract.deals.sort((a, b) => (a.closingOn ?? "9999").localeCompare(b.closingOn ?? "9999"));
  summary.closed.deals.sort((a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? ""));

  return summary;
}
