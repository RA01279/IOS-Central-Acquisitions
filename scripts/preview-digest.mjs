// scripts/preview-digest.mjs
// Renders the morning-digest email HTML from live data and writes it to a
// file -- same composition as /api/cron/digest, for previewing/testing.
//   node scripts/preview-digest.mjs <out.html>
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""), l.slice(l.indexOf("=") + 1).trim()])
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const APP_URL = "https://ios-central-acquisitions.vercel.app";
const DAY_MS = 86400000;
const STALE_DAYS = 14;
const STAGES = ["prospect", "uw", "offered", "moving_to_psa", "due_diligence"];
const LABELS = { prospect: "Prospect", uw: "UW", offered: "Offered", moving_to_psa: "Moving to PSA", due_diligence: "Due Diligence" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const today = new Date().toISOString().slice(0, 10);
const [dealsRes, tasksRes] = await Promise.all([
  supabase.from("deals").select("id, deal_type, stage, created_at, follow_up_on, pursuit_score, properties(address), deal_events(created_at)"),
  supabase.from("tasks").select("id, title, due_date, assigned_to, deal_id").eq("status", "open"),
]);
const deals = dealsRes.data ?? [];
const tasks = tasksRes.data ?? [];

const overdue = tasks.filter((t) => t.due_date && new Date(t.due_date + "T23:59:59") < new Date());
const targetsDue = deals.filter((d) => d.deal_type === "acquisition" && d.stage === "archived" && d.follow_up_on && d.follow_up_on <= today && d.pursuit_score !== 0);
const active = deals.filter((d) => d.stage !== "archived");
const stale = active
  .map((d) => {
    const last = (d.deal_events ?? []).map((e) => e.created_at).sort().pop() ?? d.created_at;
    return { ...d, staleDays: Math.floor((Date.now() - new Date(last).getTime()) / DAY_MS) };
  })
  .filter((d) => d.staleDays >= STALE_DAYS)
  .sort((a, b) => b.staleDays - a.staleDays);
const acq = active.filter((d) => d.deal_type === "acquisition");
const snapshot = STAGES.map((s) => `${acq.filter((d) => d.stage === s).length} ${LABELS[s]}`).join(" · ");

const section = (title, items, emptyText) => `
  <h3 style="margin:18px 0 6px;font-size:14px;color:#1f3b4d;">${title}</h3>
  ${items.length
    ? `<ul style="margin:0;padding-left:18px;color:#1f2937;font-size:13px;line-height:1.7;">${items.slice(0, 15).join("")}${items.length > 15 ? `<li>…and ${items.length - 15} more</li>` : ""}</ul>`
    : `<p style="margin:0;color:#6b7280;font-size:13px;">${emptyText}</p>`}`;
const dealLink = (d) => `<a href="${APP_URL}/deals/${d.id}" style="color:#2e6e62;">${esc(d.properties?.address ?? "Untitled")}</a>`;

const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;">
  <h2 style="color:#1f3b4d;margin:0 0 4px;">Hopper morning digest</h2>
  <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Pipeline: ${esc(snapshot)} · <a href="${APP_URL}/dashboard" style="color:#2e6e62;">open dashboard</a></p>
  ${section(`⚠ Overdue follow-ups (${overdue.length})`, overdue.map((t) => `<li>${esc(t.title)} — due ${t.due_date}${t.assigned_to ? ` · ${esc(t.assigned_to)}` : ""}${t.deal_id ? ` · <a href="${APP_URL}/deals/${t.deal_id}" style="color:#2e6e62;">deal</a>` : ""}</li>`), "Nothing overdue.")}
  ${section(`🎯 Targets due for re-approach (${targetsDue.length})`, targetsDue.map((d) => `<li>${dealLink(d)}${d.pursuit_score ? ` · ${"★".repeat(d.pursuit_score)}` : ""} — follow up ${d.follow_up_on}</li>`), "No targets due.")}
  ${section(`🕰 Stale deals — no touch in ${STALE_DAYS}+ days (${stale.length})`, stale.map((d) => `<li>${dealLink(d)} — ${d.staleDays} days · ${LABELS[d.stage] ?? d.stage}</li>`), "Nothing stale.")}
  <p style="margin:20px 0 0;color:#9ca3af;font-size:11px;">Sent by Hopper · ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" })}</p>
</div>`;

const out = process.argv[2] ?? "digest-preview.html";
writeFileSync(out, html);
console.log(`Wrote ${out} — overdue:${overdue.length} targets:${targetsDue.length} stale:${stale.length}`);
