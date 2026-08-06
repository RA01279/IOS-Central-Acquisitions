// app/api/cron/digest/route.ts
// Morning digest email: overdue follow-ups, targets due, stale deals, and a
// pipeline snapshot. Triggered by Vercel Cron (see vercel.json) each weekday.
//
// Sender is provider-agnostic, resolved from env:
//   REMINDER_WEBHOOK_URL  -> POST {to, subject, html} (e.g. a Power Automate
//                            flow that sends from a team member's mailbox)
//   RESEND_API_KEY        -> Resend API (DIGEST_FROM sets the from address)
// Recipients: DIGEST_RECIPIENTS (comma-separated) or PSA_CONFIRM_ALLOWLIST.
// Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token).
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { ACQUISITION_STAGES, STAGE_LABELS } from "@/lib/deals";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const APP_URL = "https://ios-central-acquisitions.vercel.app";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const key = req.nextUrl.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

  // --- compose HTML ----------------------------------------------------------
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
      stale.map((d: any) => `<li>${dealLink(d)} — ${d.staleDays} days · ${STAGE_LABELS[d.stage] ?? d.stage}</li>`),
      "Nothing stale."
    )}
    <p style="margin:20px 0 0;color:#9ca3af;font-size:11px;">Sent by Hopper · ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" })}</p>
  </div>`;

  const subject = `Hopper digest — ${overdue.length} overdue · ${targetsDue.length} targets due · ${stale.length} stale`;
  const recipients = (process.env.DIGEST_RECIPIENTS ?? process.env.PSA_CONFIRM_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    return NextResponse.json({ sent: false, reason: "No recipients configured" });
  }

  // --- send via whichever provider is configured -------------------------------
  // Webhook URL comes from app_settings (writable without a redeploy) or env.
  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "reminder_webhook_url")
    .maybeSingle();
  const webhookUrl = setting?.value ?? process.env.REMINDER_WEBHOOK_URL;
  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipients.join(";"), subject, html }),
    });
    return NextResponse.json({
      sent: res.ok,
      via: "webhook",
      status: res.status,
      counts: { overdue: overdue.length, targetsDue: targetsDue.length, stale: stale.length },
    });
  }
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM ?? "Hopper <onboarding@resend.dev>",
        to: recipients,
        subject,
        html,
      }),
    });
    return NextResponse.json({ sent: res.ok, via: "resend", status: res.status });
  }
  return NextResponse.json({
    sent: false,
    reason: "No sender configured (set REMINDER_WEBHOOK_URL or RESEND_API_KEY)",
    preview: { subject, recipients },
  });
}
