// scripts/rollup-dashboard.mjs
//
// Reference consumer for the read-only export API -- the "external roll-up
// dashboard" in one file. Fetches /api/export, renders a self-contained static
// HTML page, and writes it to disk:
//
//   node scripts/rollup-dashboard.mjs [out.html] [baseUrl]
//   node scripts/rollup-dashboard.mjs rollup.html http://localhost:3000
//
// Why a generator and not a web app: the export token must never reach a
// browser. This runs server-side (your laptop, a cron box, a CI job), the
// token stays in the process, and what gets published is inert HTML with no
// credentials in it. Point a scheduled job at this and drop the output on a
// share, or copy the fetch-and-shape logic into a real dashboard's server
// route -- that's the pattern the handoff doc describes.
//
// Deliberately dependency-free apart from @supabase/supabase-js, which is only
// used to look up the current export token so a rotation doesn't break this.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim().replace(/^﻿/, ""),
      l.slice(l.indexOf("=") + 1).trim(),
    ])
);

const out = process.argv[2] ?? "rollup.html";
const baseUrl = (process.argv[3] ?? "https://ios-central-acquisitions.vercel.app").replace(/\/$/, "");

// Token: env override first (so this can run without database access at all),
// otherwise read the live value from app_settings.
let token = env.EXPORT_TOKEN;
if (!token) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "export_token")
    .maybeSingle();
  if (error) {
    console.error(`Could not read export_token: ${error.message}`);
    process.exit(1);
  }
  token = data?.value;
}
if (!token) {
  console.error("No export token. Set EXPORT_TOKEN in .env.local or add the app_settings row.");
  process.exit(1);
}

const res = await fetch(`${baseUrl}/api/export?token=${encodeURIComponent(token)}`);
if (res.status === 401) {
  console.error("HTTP 401 -- the token was rejected. It may have been rotated.");
  process.exit(1);
}
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const d = await res.json();

if (d.schemaVersion !== 2) {
  console.warn(
    `Warning: expected schemaVersion 2, got ${d.schemaVersion ?? "(none)"}. Rendering anyway.`
  );
}

// -- rendering --------------------------------------------------------------

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (v) =>
  !v ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`;
const CLASS_LABELS = { ios: "IOS", industrial: "Industrial" };
const classes = d.assetClasses ?? ["ios", "industrial"];

const tile = (value, label, sub) => `
  <div class="tile">
    <div class="tile-value">${esc(value)}</div>
    <div class="tile-label">${esc(label)}</div>
    ${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ""}
  </div>`;

// Stage matrix: rows are asset classes, columns are pipeline stages.
const stageKeys = Object.keys(d.acquisitions?.byStage ?? {});
const stageMatrix = `
  <table>
    <thead><tr><th></th>${stageKeys
      .map((s) => `<th>${esc(s.replace(/_/g, " "))}</th>`)
      .join("")}<th>In contract</th><th>Total</th></tr></thead>
    <tbody>
      ${classes
        .map((c) => {
          const row = d.acquisitions?.byStageAndAssetClass?.[c] ?? {};
          const inC = d.acquisitions?.inContract?.byAssetClass?.[c] ?? 0;
          return `<tr><th>${esc(CLASS_LABELS[c] ?? c)}</th>${stageKeys
            .map((s) => `<td>${row[s] ?? 0}</td>`)
            .join("")}<td>${inC}</td><td><strong>${
            d.acquisitions?.byAssetClass?.[c] ?? 0
          }</strong></td></tr>`;
        })
        .join("")}
      <tr class="total"><th>Total</th>${stageKeys
        .map((s) => `<td>${d.acquisitions?.byStage?.[s] ?? 0}</td>`)
        .join("")}<td>${d.acquisitions?.inContract?.count ?? 0}</td><td><strong>${
        d.acquisitions?.activeCount ?? 0
      }</strong></td></tr>
    </tbody>
  </table>`;

const closedBlock = (label, block) => `
  <tr>
    <th>${esc(label)}</th>
    ${classes.map((c) => `<td>${block?.byAssetClass?.[c] ?? 0}</td>`).join("")}
    <td><strong>${block?.count ?? 0}</strong></td>
    <td>${money(block?.lastOfferValueTotal ?? 0)}</td>
  </tr>`;

const dealRows = (deals, extra) =>
  !deals?.length
    ? `<tr><td colspan="6" class="muted">Nothing to show.</td></tr>`
    : deals
        .map(
          (x) => `<tr>
            <td><a href="${esc(x.url)}">${esc(x.address ?? "Untitled")}</a></td>
            <td>${esc(x.market ?? "—")}</td>
            <td>${esc(CLASS_LABELS[x.assetClass] ?? x.assetClass)}</td>
            <td>${esc(x.stageLabel ?? x.stage)}</td>
            <td class="num">${money(x.lastOfferPrice)}</td>
            <td>${esc(extra(x))}</td>
          </tr>`
        )
        .join("");

const marketRows = Object.entries(d.acquisitions?.byMarket ?? {})
  .sort((a, b) => b[1].count - a[1].count)
  .map(
    ([market, v]) =>
      `<tr><th>${esc(market)}</th>${classes
        .map((c) => `<td>${v.byAssetClass?.[c] ?? 0}</td>`)
        .join("")}<td><strong>${v.count}</strong></td></tr>`
  )
  .join("");

const milestoneRows = !d.milestones?.items?.length
  ? `<tr><td colspan="4" class="muted">No DD deadlines or closings in the next 7 days.</td></tr>`
  : d.milestones.items
      .map(
        (m) => `<tr class="${m.daysAway < 0 ? "bad" : ""}">
          <td><a href="${esc(m.url)}">${esc(m.address ?? "Untitled")}</a></td>
          <td>${m.kind === "dd_end" ? "DD expires" : "Closing"}</td>
          <td>${esc(m.date)}</td>
          <td>${m.daysAway < 0 ? `${Math.abs(m.daysAway)}d overdue` : m.daysAway === 0 ? "today" : `in ${m.daysAway}d`}</td>
        </tr>`
      )
      .join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Central Acquisitions roll-up</title>
<style>
  :root { --ink:#1f2937; --muted:#6b7280; --border:#e2e5e9; --bg:#f7f8fa; --panel:#fff;
          --accent:#1f3b4d; --accent-2:#2e6e62; --error:#b3261e; }
  * { box-sizing:border-box }
  body { margin:0; font-family:-apple-system,"Segoe UI",Arial,sans-serif; background:var(--bg);
         color:var(--ink); }
  main { max-width:1200px; margin:0 auto; padding:32px 24px 64px }
  h1 { font-size:26px; margin:0 }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted);
       margin:0 0 12px }
  a { color:var(--accent-2) }
  .muted { color:var(--muted); font-size:13px }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:10px;
           padding:20px; margin-bottom:16px; overflow-x:auto }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px;
           margin:20px 0 }
  .tile { background:var(--panel); border:1px solid var(--border); border-radius:10px;
          padding:16px 20px }
  .tile-value { font-size:28px; font-weight:600 }
  .tile-label { font-size:12px; color:var(--muted) }
  .tile-sub { font-size:11px; color:var(--accent-2); margin-top:2px }
  table { width:100%; border-collapse:collapse; font-size:14px }
  th, td { padding:7px 10px; text-align:right; border-bottom:1px solid var(--border);
           font-variant-numeric:tabular-nums; font-weight:400; white-space:nowrap }
  thead th { font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--muted) }
  tbody th, thead th:first-child, td:first-child { text-align:left }
  tr.total th, tr.total td { font-weight:600; border-top:2px solid var(--border) }
  tr.bad td { color:var(--error) }
  td.num { text-align:right }
  footer { color:var(--muted); font-size:12px; margin-top:24px }
</style></head><body><main>
  <h1>Central Acquisitions roll-up</h1>
  <p class="muted">
    Snapshot ${esc(d.generatedAt)} · as of ${esc(d.asOfDate)} CT ·
    source <a href="${esc(d.app?.url ?? baseUrl)}">${esc(d.app?.name ?? "Central Acquisitions")}</a>
    · schema v${esc(d.schemaVersion)}
  </p>

  <div class="tiles">
    ${tile(d.acquisitions?.activeCount ?? 0, "Active pipeline",
      classes.map((c) => `${CLASS_LABELS[c]} ${d.acquisitions?.byAssetClass?.[c] ?? 0}`).join(" · "))}
    ${tile(d.acquisitions?.inContract?.count ?? 0, "In contract",
      `${money(d.acquisitions?.inContract?.lastOfferValueTotal ?? 0)} at last offer`)}
    ${tile(d.offers?.monthToDate?.count ?? 0, "Offers month to date",
      `${money(d.offers?.monthToDate?.value ?? 0)} offered`)}
    ${tile(d.closed?.yearToDate?.count ?? 0, "Closed year to date",
      `${money(d.closed?.yearToDate?.lastOfferValueTotal ?? 0)}`)}
    ${tile(d.tasks?.open ?? 0, "Open follow-ups",
      `${d.tasks?.overdue ?? 0} overdue`)}
    ${tile(d.targets?.dueCount ?? 0, "Targets due", "archived deals to re-approach")}
  </div>

  <section class="panel"><h2>Pipeline by asset class</h2>${stageMatrix}</section>

  <section class="panel"><h2>Closings</h2>
    <table>
      <thead><tr><th></th>${classes
        .map((c) => `<th>${esc(CLASS_LABELS[c] ?? c)}</th>`)
        .join("")}<th>Total</th><th>Last-offer value</th></tr></thead>
      <tbody>
        ${closedBlock("Last 7 days", d.closed?.last7Days)}
        ${closedBlock("Month to date", d.closed?.monthToDate)}
        ${closedBlock("Year to date", d.closed?.yearToDate)}
      </tbody>
    </table>
  </section>

  <section class="panel"><h2>Next ${esc(d.milestones?.withinDays ?? 7)} days — DD expirations &amp; closings</h2>
    <table>
      <thead><tr><th>Property</th><th>Milestone</th><th>Date</th><th>When</th></tr></thead>
      <tbody>${milestoneRows}</tbody>
    </table>
  </section>

  <section class="panel"><h2>In contract</h2>
    <table>
      <thead><tr><th>Property</th><th>Market</th><th>Class</th><th>Stage</th><th>Last offer</th><th>Dates</th></tr></thead>
      <tbody>${dealRows(
        d.acquisitions?.deals?.filter((x) =>
          (d.acquisitions?.inContract?.stages ?? ["moving_to_psa", "due_diligence"]).includes(x.stage)
        ),
        (x) => [x.ddEndOn ? `DD to ${x.ddEndOn}` : null, x.closingOn ? `closes ${x.closingOn}` : null]
          .filter(Boolean)
          .join(" · ") || "—"
      )}</tbody>
    </table>
  </section>

  <section class="panel"><h2>Closed deals</h2>
    <table>
      <thead><tr><th>Property</th><th>Market</th><th>Class</th><th>Stage</th><th>Last offer</th><th>Closed</th></tr></thead>
      <tbody>${dealRows(d.closed?.deals, (x) => x.closedOn ?? "—")}</tbody>
    </table>
  </section>

  <section class="panel"><h2>Active pipeline by market</h2>
    <table>
      <thead><tr><th>Market</th>${classes
        .map((c) => `<th>${esc(CLASS_LABELS[c] ?? c)}</th>`)
        .join("")}<th>Total</th></tr></thead>
      <tbody>${marketRows || `<tr><td class="muted">No active deals.</td></tr>`}</tbody>
    </table>
  </section>

  <footer>
    Generated by scripts/rollup-dashboard.mjs. Dollar figures are the most recent offer on each
    deal — the tracker holds no contract price. Deal links require a Central Acquisitions login.
    No credentials are embedded in this file.
  </footer>
</main></body></html>`;

writeFileSync(out, html);
console.log(
  `Wrote ${out} — ${d.acquisitions?.activeCount ?? 0} active, ${
    d.acquisitions?.inContract?.count ?? 0
  } in contract, ${d.closed?.yearToDate?.count ?? 0} closed YTD, ${
    d.milestones?.items?.length ?? 0
  } milestones in 7d`
);
