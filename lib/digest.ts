// lib/digest.ts
// Composes the morning digest (subject + HTML): overdue follow-ups, targets
// due, stale deals, pipeline snapshot. Shared by the cron webhook route and
// the RSS feed (the Power Automate premium-license workaround: a free
// Recurrence+RSS flow pulls this instead of Hopper pushing to a premium
// HTTP trigger).
import { getServiceClient } from "./supabase";
import { ACQUISITION_STAGES, STAGE_LABELS } from "./deals";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const APP_URL = "https://ios-central-acquisitions.vercel.app";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function composeDigest() {
  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const [dealsRes, tasksRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, deal_type, stage, created_at, follow_up_on, pursuit_score, properties(address), deal_events(created_at)"
      ),
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
      d.deal_type === "acquisition" &&
      d.stage === "archived" &&
      d.follow_up_on &&
      d.follow_up_on <= today &&
      d.pursuit_score !== 0
  );
  const active = deals.filter((d: any) => d.stage !== "archived");
  const stale = active
    .map((d: any) => {
      const last = (d.deal_events ?? []).map((e: any) => e.created_at).sort().pop() ?? d.created_at;
      return { ...d, staleDays: Math.floor((Date.now() - new Date(last).getTime()) / DAY_MS) };
    })
    .filter((d: any) => d.staleDays >= STALE_DAYS)
    .sort((a: any, b: any) => b.staleDays - a.staleDays);

  const acq = active.filter((d: any) => d.deal_type === "acquisition");
  const snapshot = ACQUISITION_STAGES.map(
    (s) => `${acq.filter((d: any) => d.stage === s).length} ${STAGE_LABELS[s]}`
  ).join(" · ");

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

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;">
    <h2 style="color:#1f3b4d;margin:0 0 4px;">Hopper morning digest</h2>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">
      Pipeline: ${esc(snapshot)} · <a href="${APP_URL}/dashboard" style="color:#2e6e62;">open dashboard</a>
    </p>
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
    <p style="margin:20px 0 0;color:#9ca3af;font-size:11px;">Sent by Hopper · ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" })}</p>
  </div>`;

  const subject = `Hopper digest — ${overdue.length} overdue · ${targetsDue.length} targets due · ${stale.length} stale`;

  return {
    subject,
    html,
    counts: { overdue: overdue.length, targetsDue: targetsDue.length, stale: stale.length },
  };
}
