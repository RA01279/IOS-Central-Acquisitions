// lib/digest.ts
// Composes the morning brief (subject + HTML): DD expirations and closings
// inside 7 days, overdue follow-ups, targets due, stale deals, and a
// bifurcated pipeline snapshot. Shared by the cron webhook route and the RSS
// feed (the Power Automate premium-license workaround: a free Recurrence+RSS
// flow pulls this instead of Hopper pushing to a premium HTTP trigger).
//
// This is the single source of the brief -- the cron route used to carry its
// own copy of the same composition, and the two drifted.
import { getServiceClient } from "./supabase";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "./deals";
import {
  assetClassOf,
  ctDate,
  ctToday,
  dealValue,
  MILESTONE_LABELS,
  upcomingMilestones,
  type Milestone,
} from "./summary";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const MILESTONE_WINDOW_DAYS = 7;
const APP_URL = "https://ios-central-acquisitions.vercel.app";

// Stages shown in the header snapshot. 'closed' is excluded on purpose: closed
// deals accumulate in that column forever, so a standing count of them says
// nothing about this morning. Closings are reported YTD instead.
const SNAPSHOT_STAGES = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence"] as const;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function composeDigest() {
  const supabase = getServiceClient();
  const today = ctToday();

  const [dealsRes, tasksRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, deal_type, stage, asset_class, created_at, follow_up_on, pursuit_score, dd_end_on, closing_on, closed_on, contract_price, closed_price, properties(address), offers(price, offered_at), deal_events(created_at)"
      )
      .eq("deal_type", "acquisition"),
    supabase
      .from("tasks")
      .select("id, title, due_date, assigned_to, deal_id, contact_id")
      .eq("status", "open"),
  ]);
  const deals = dealsRes.data ?? [];
  const tasks = tasksRes.data ?? [];

  const overdue = tasks.filter(
    (t: any) => t.due_date && new Date(t.due_date + "T23:59:59") < new Date()
  );
  const targetsDue = deals.filter(
    (d: any) =>
      d.stage === "archived" &&
      d.follow_up_on &&
      d.follow_up_on <= today &&
      d.pursuit_score !== 0
  );
  const active = deals.filter((d: any) => d.stage !== "archived");

  // The reminder the boss asked for: any DD expiry or closing within 7 days
  // (and anything already past that hasn't moved -- overdue is more urgent).
  const milestones = upcomingMilestones(deals, { today, withinDays: MILESTONE_WINDOW_DAYS });

  const stale = active
    .filter((d: any) => d.stage !== "closed")
    .map((d: any) => {
      const last = (d.deal_events ?? []).map((e: any) => e.created_at).sort().pop() ?? d.created_at;
      return { ...d, staleDays: Math.floor((Date.now() - new Date(last).getTime()) / DAY_MS) };
    })
    .filter((d: any) => d.staleDays >= STALE_DAYS)
    .sort((a: any, b: any) => b.staleDays - a.staleDays);

  // Bifurcated snapshot: one line per pipeline, so nobody has to mentally
  // separate IOS from Industrial before reading the numbers.
  const snapshotLine = (assetClass: string) => {
    const inClass = active.filter((d: any) => assetClassOf(d) === assetClass);
    const parts = SNAPSHOT_STAGES.map(
      (s) => `${inClass.filter((d: any) => d.stage === s).length} ${STAGE_LABELS[s]}`
    ).join(" · ");
    return `<strong>${ASSET_CLASS_LABELS[assetClass]}</strong> ${esc(parts)}`;
  };

  const yearStart = `${today.slice(0, 4)}-01-01`;
  const closedYtd = deals.filter(
    (d: any) => d.stage === "closed" && (d.closed_on ?? ctDate(d.created_at)) >= yearStart
  );
  // Real closings, in real money, with the caveat attached when any of it is
  // inferred from an offer rather than a recorded closing price.
  const closedYtdValue = closedYtd.reduce((sum: number, d: any) => sum + (dealValue(d).amount ?? 0), 0);
  const closedYtdEstimated = closedYtd.filter((d: any) => dealValue(d).basis !== "closed").length;
  const fmtM = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v > 0 ? `$${Math.round(v / 1_000)}K` : "$0";

  const section = (title: string, items: string[], emptyText: string) => `
    <h3 style="margin:18px 0 6px;font-size:14px;color:#1f3b4d;">${title}</h3>
    ${
      items.length
        ? `<ul style="margin:0;padding-left:18px;color:#1f2937;font-size:13px;line-height:1.7;">${items
            .slice(0, 15)
            .join("")}${items.length > 15 ? `<li>…and ${items.length - 15} more</li>` : ""}</ul>`
        : `<p style="margin:0;color:#6b7280;font-size:13px;">${emptyText}</p>`
    }`;

  const dealLink = (d: any) =>
    `<a href="${APP_URL}/deals/${d.id}" style="color:#2e6e62;">${esc(d.properties?.address ?? "Untitled")}</a>`;

  const milestoneLine = (m: Milestone) => {
    const when =
      m.daysAway < 0
        ? `<strong style="color:#b3261e;">${Math.abs(m.daysAway)} day${Math.abs(m.daysAway) === 1 ? "" : "s"} OVERDUE</strong>`
        : m.daysAway === 0
          ? `<strong style="color:#b3261e;">TODAY</strong>`
          : `in ${m.daysAway} day${m.daysAway === 1 ? "" : "s"}`;
    return `<li><a href="${APP_URL}/deals/${m.dealId}" style="color:#2e6e62;">${esc(
      m.address ?? "Untitled"
    )}</a> — ${MILESTONE_LABELS[m.kind]} ${m.date}, ${when} · ${
      ASSET_CLASS_LABELS[m.assetClass]
    }</li>`;
  };

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;">
    <h2 style="color:#1f3b4d;margin:0 0 4px;">Central Acquisitions morning brief</h2>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">
      ${ASSET_CLASSES.map(snapshotLine).join("<br/>")}<br/>
      ${closedYtd.length} closed YTD${closedYtd.length ? ` · ${fmtM(closedYtdValue)}` : ""}${
        closedYtdEstimated ? ` (${closedYtdEstimated} without a recorded closing price)` : ""
      } ·
      <a href="${APP_URL}/" style="color:#2e6e62;">open home screen</a>
    </p>
    ${section(
      `⏳ DD expirations &amp; closings — next ${MILESTONE_WINDOW_DAYS} days (${milestones.length})`,
      milestones.map(milestoneLine),
      "No DD deadlines or closings in the next 7 days."
    )}
    ${section(
      `⚠ Overdue follow-ups (${overdue.length})`,
      overdue.map(
        (t: any) =>
          `<li>${esc(t.title)} — due ${t.due_date}${t.assigned_to ? ` · ${esc(t.assigned_to)}` : ""}${
            t.deal_id ? ` · <a href="${APP_URL}/deals/${t.deal_id}" style="color:#2e6e62;">deal</a>` : ""
          }</li>`
      ),
      "Nothing overdue."
    )}
    ${section(
      `🎯 Targets due for re-approach (${targetsDue.length})`,
      targetsDue.map(
        (d: any) =>
          `<li>${dealLink(d)}${d.pursuit_score ? ` · ${"★".repeat(d.pursuit_score)}` : ""} — follow up ${d.follow_up_on}</li>`
      ),
      "No targets due."
    )}
    ${section(
      `🕰 Stale deals — no touch in ${STALE_DAYS}+ days (${stale.length})`,
      stale.map(
        (d: any) => `<li>${dealLink(d)} — ${d.staleDays} days · ${STAGE_LABELS[d.stage] ?? d.stage}</li>`
      ),
      "Nothing stale."
    )}
    <p style="margin:20px 0 0;color:#9ca3af;font-size:11px;">Sent by Central Acquisitions · ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" })}</p>
  </div>`;

  // Milestones lead the subject line: a closing in 3 days is the one thing
  // that has to survive being read on a phone lock screen.
  const subjectParts = [
    milestones.length ? `${milestones.length} DD/closing in 7d` : null,
    `${overdue.length} overdue`,
    `${targetsDue.length} targets due`,
    `${stale.length} stale`,
  ].filter(Boolean);
  const subject = `Central Acquisitions brief — ${subjectParts.join(" · ")}`;

  return {
    subject,
    html,
    counts: {
      milestones: milestones.length,
      overdue: overdue.length,
      targetsDue: targetsDue.length,
      stale: stale.length,
      closedYtd: closedYtd.length,
    },
  };
}
