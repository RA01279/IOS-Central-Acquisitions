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
import { fetchAll } from "./fetch-all";
import { offerDeadlines, offerDeadlineLine } from "./offer-deadlines";
import { ASSET_CLASSES, ASSET_CLASS_LABELS, STAGE_LABELS } from "./deals";
import {
  assetClassOf,
  ctDate,
  ctToday,
  rangeStart,
  dealValue,
  MILESTONE_LABELS,
  upcomingMilestones,
  type Milestone,
} from "./summary";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const MILESTONE_WINDOW_DAYS = 7;
const LEASE_WINDOW_DAYS = 180;
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
  const offerWindowStart = rangeStart("7d", today);

  // Throws on any failed query: a brief that says "nothing due" because the
  // database blipped is worse than no brief.
  const horizon = new Date(Date.parse(`${today}T12:00:00Z`) + MILESTONE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const [deals, tasksRes, diligenceRes, leasesRes, recentOffers] = await Promise.all([
    fetchAll((from, to) => supabase
      .from("deals")
      .select(
        "id, deal_type, stage, asset_class, assigned_analyst, created_at, follow_up_on, pursuit_score, call_for_offers_on, offer_round, dd_end_on, closing_on, closed_on, contract_price, closed_price, properties(address), offers(price, offered_at), tasks(title, due_date, status), deal_events(created_at)"
      )
      .eq("deal_type", "acquisition")
      .order("id")
      .range(from, to)),
    supabase
      .from("tasks")
      .select("id, title, due_date, assigned_to, deal_id, contact_id, deals(id, properties(address))")
      .eq("status", "open"),
    // Diligence deadlines (Diligence tab). DD expiry and closing are already
    // in the milestone section, from the deal's own dates.
    supabase
      .from("deal_milestones")
      .select("label, due_on, deal_id, deals!inner(stage, properties(address))")
      .is("done_on", null)
      .not("due_on", "is", null)
      .lte("due_on", horizon)
      // Hand-added milestones have no key; "not in" alone would drop them.
      .or("key.is.null,key.not.in.(dd_end,closing)")
      .not("deals.stage", "in", "(archived,closed)")
      .order("due_on")
      .limit(200),
    // Leases on owned assets ending within 180 days (asset rent rolls).
    supabase
      .from("asset_leases")
      .select("tenant, expires_on, asset_id, assets!inner(address, status)")
      .eq("status", "active")
      .not("expires_on", "is", null)
      .lte("expires_on", new Date(Date.parse(`${today}T12:00:00Z`) + LEASE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10))
      .eq("assets.status", "owned")
      .order("expires_on")
      .limit(100),
    // Fetch offers directly and page the result so embedded relation limits
    // cannot truncate a busy week's activity.
    fetchAll((from, to) => supabase.from("offers")
      .select("id, price, offered_at, deals!inner(deal_type)")
      .eq("deals.deal_type", "acquisition")
      .gte("offered_at", offerWindowStart)
      .lte("offered_at", today)
      .order("id")
      .range(from, to)),
  ]);
  if (tasksRes.error) throw new Error(`Loading tasks: ${tasksRes.error.message}`);
  if (leasesRes.error) throw new Error(`Loading lease expirations: ${leasesRes.error.message}`);
  const expiring = (leasesRes.data ?? []) as any[];
  const leaseLine = (l: any) => {
    const days = Math.round((Date.parse(`${l.expires_on}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY_MS);
    const when = days < 0 ? `<strong style="color:#b3261e;">expired ${-days} days ago</strong>` : days <= 90 ? `<strong style="color:#b3261e;">in ${days} days</strong>` : `in ${days} days`;
    return `<li><a href="${APP_URL}/assets/${l.asset_id}" style="color:#2e6e62;">${esc(l.assets?.address ?? "Asset")}</a> — ${esc(l.tenant)} lease ends ${l.expires_on}, ${when}</li>`;
  };
  if (diligenceRes.error) throw new Error(`Loading diligence deadlines: ${diligenceRes.error.message}`);
  const diligence = (diligenceRes.data ?? []) as any[];
  const diligenceLine = (m: any) => {
    const days = Math.round((Date.parse(`${m.due_on}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY_MS);
    const when =
      days < 0
        ? `<strong style="color:#b3261e;">${-days} day${days === -1 ? "" : "s"} OVERDUE</strong>`
        : days === 0
          ? `<strong style="color:#b3261e;">TODAY</strong>`
          : `in ${days} day${days === 1 ? "" : "s"}`;
    return `<li><a href="${APP_URL}/deals/${m.deal_id}/diligence" style="color:#2e6e62;">${esc(
      m.deals?.properties?.address ?? "Untitled"
    )}</a> — ${esc(m.label)} ${m.due_on}, ${when}</li>`;
  };
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
  const callsForOffers = offerDeadlines(deals as any[], today);
  const offersTomorrow = callsForOffers.filter(d => d.daysAway === 1);

  // Match the offer log's seven CT calendar days, including today. Count
  // dated offers even when the deal has since closed or been archived.
  const pricedOffers = recentOffers.filter((o: any) =>
    o.price !== null && o.price !== undefined && o.price !== "" && Number.isFinite(Number(o.price)));
  const recentOfferValue = pricedOffers.reduce((sum: number, o: any) => sum + Number(o.price), 0);
  const unpricedOffers = recentOffers.length - pricedOffers.length;

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

  // Per owner (deals.assigned_analyst): what each person is carrying and what
  // is due on their deals this week.
  const ownerOf = (dealId: string) => deals.find((d: any) => d.id === dealId)?.assigned_analyst ?? null;
  const owners = new Map<string, { active: number; due: number; stale: number }>();
  const bump = (owner: string | null, k: "active" | "due" | "stale") => {
    const key = owner ? String(owner).toLowerCase() : "Unassigned";
    const o = owners.get(key) ?? { active: 0, due: 0, stale: 0 };
    o[k]++;
    owners.set(key, o);
  };
  for (const d of active) if (d.stage !== "closed") bump(d.assigned_analyst, "active");
  for (const m of milestones) bump(ownerOf(m.dealId), "due");
  for (const m of diligence) bump(ownerOf(m.deal_id), "due");
  for (const d of callsForOffers) if (d.daysAway <= 7) bump(d.assigned_analyst ?? null, "due");
  for (const d of stale) bump(d.assigned_analyst, "stale");
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

  // Table-based layout and inline styles survive RSS -> Power Automate -> Outlook.
  const row = (content: string) => `<tr><td style="padding:14px 16px;border-bottom:1px solid #DDE4EB;font-size:14px;line-height:1.65;color:#364049;">${content.replace(/^<li>/, "").replace(/<\/li>$/, "").replace(/color:#2e6e62/g, "color:#0E5AA7")}</td></tr>`;
  const section = (title: string, items: string[], emptyText: string) => `
    <tr><td style="padding:24px 24px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #DDE4EB;border-collapse:collapse;">
        <tr><td style="padding:16px;border-top:3px solid #4E9FD6;border-bottom:1px solid #DDE4EB;">
          <h2 style="margin:0;font-family:Archivo,Arial,sans-serif;font-size:17px;color:#0A2540;">${title}</h2>
        </td></tr>
        ${items.length ? items.slice(0, 15).map(row).join("") : row(`<span style="color:#6B7A88;">${emptyText}</span>`)}
        ${items.length > 15 ? row(`<a href="${APP_URL}/" style="color:#0E5AA7;">View ${items.length - 15} more in Hopper</a>`) : ""}
      </table>
    </td></tr>`;
  const stat = (value: string, label: string, width = 33) => `<td width="${width}%" valign="top" style="padding:18px 8px;border:1px solid #DDE4EB;text-align:center;"><div style="font-family:Archivo,Arial,sans-serif;font-size:30px;font-weight:700;line-height:1.2;color:#0A2540;">${value}</div><div style="margin-top:7px;font-size:10px;font-weight:700;letter-spacing:1px;color:#6B7A88;">${label}</div></td>`;
  const pipeline = ASSET_CLASSES.map(assetClass => {
    const inClass = active.filter((d: any) => assetClassOf(d) === assetClass && d.stage !== "closed");
    const stages = SNAPSHOT_STAGES.map(stage => ({ label: STAGE_LABELS[stage], count: inClass.filter((d: any) => d.stage === stage).length }));
    const max = Math.max(1, ...stages.map(s => s.count));
    const colors = ["#9EC3E5", "#4E9FD6", "#3E82C4", "#0E5AA7", "#0A2540"];
    return `<tr><td style="padding:16px;border-bottom:1px solid #DDE4EB;">
      <div style="font-size:14px;font-weight:700;color:#0A2540;margin-bottom:12px;">${ASSET_CLASS_LABELS[assetClass]} <span style="color:#6B7A88;font-weight:400;">/ ${inClass.length} active</span></div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stages.map((s, i) => `<tr><td width="115" style="font-size:12px;color:#4C5966;padding:5px 8px 5px 0;">${s.label}</td><td style="padding:5px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="${Math.max(1, Math.round(s.count / max * 100))}%" height="10" bgcolor="${s.count ? colors[i] : "#FFFFFF"}" style="height:10px;font-size:1px;line-height:10px;">&nbsp;</td><td></td></tr></table></td><td width="32" align="right" style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:13px;font-weight:700;color:#0A2540;">${s.count}</td></tr>`).join("")}</table>
    </td></tr>`;
  }).join("");

  const dealLink = (d: any) =>
    `<a href="${APP_URL}/deals/${d.id}" style="color:#2e6e62;">${esc(d.properties?.address ?? "Untitled")}</a>`;

  const overdueLine = (t: any) => {
    const linkedDeal = t.deals ?? deals.find((d: any) => d.id === t.deal_id);
    const context = t.deal_id
      ? `<a href="${APP_URL}/deals/${encodeURIComponent(t.deal_id)}" style="color:#0E5AA7;font-weight:700;">${esc(linkedDeal?.properties?.address || "Untitled deal")}</a>`
      : `<span style="color:#6B7A88;">No associated deal</span>`;
    return `<li>${context}<br/>${esc(t.title)}<br/><span style="font-size:12px;color:#6B7A88;">Due ${esc(t.due_date)}${t.assigned_to ? ` &middot; ${esc(t.assigned_to)}` : ""}</span></li>`;
  };

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

  const ownerRows = [...owners.entries()]
    .sort((a, b) => (a[0] === "Unassigned" ? 1 : b[0] === "Unassigned" ? -1 : b[1].active - a[1].active))
    .map(([who, o]) => `<tr><td style="padding:12px 10px;border-top:1px solid #DDE4EB;font-size:12px;color:#364049;word-break:break-word;">${esc(who === "Unassigned" ? who : who.split("@")[0])}</td>${[o.active, o.due, o.stale].map(n => `<td align="center" style="padding:12px 4px;border-top:1px solid #DDE4EB;font-family:Consolas,monospace;font-size:13px;color:#0A2540;">${n}</td>`).join("")}</tr>`).join("");
  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const html = `
  <div style="display:none;font-size:1px;line-height:1px;color:#FFFFFF;max-height:0;overflow:hidden;">${milestones.length + diligence.length} DD, closing and diligence deadlines; ${overdue.length} overdue follow-ups. Our acquisition pipeline at a glance.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="font-family:'Public Sans','Segoe UI',Arial,sans-serif;border-collapse:collapse;"><tr><td align="center">
  <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;border:1px solid #DDE4EB;border-collapse:collapse;">
    <tr><td bgcolor="#0A2540" style="padding:28px 24px;color:#FFFFFF;">
      <img src="https://ios-central-acquisitions.vercel.app/logo-email.png" width="176" height="44" alt="Dalfen Industrial" style="display:block;border:0;margin-bottom:24px;"/><div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#A9D0EC;">HOPPER / CENTRAL ACQUISITIONS</div>
      <h1 style="font-family:Archivo,Arial,sans-serif;font-size:30px;line-height:1.2;letter-spacing:-.5px;margin:14px 0 12px;color:#FFFFFF;">Morning Brief</h1>
      <table role="presentation" width="56" cellpadding="0" cellspacing="0"><tr><td height="4" bgcolor="#4E9FD6" style="font-size:1px;line-height:4px;">&nbsp;</td></tr></table>
      <p style="font-size:13px;color:#C4CFD9;margin:16px 0 0;">${dateLabel} &nbsp; / &nbsp; Central Time</p>
    </td></tr>
    <tr><td style="padding:24px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${stat(String(active.filter((d: any) => d.stage !== "closed").length), "ACTIVE DEALS")}${stat(String(milestones.length + diligence.length), "DEADLINES / 7D + OVERDUE")}${stat(String(overdue.length), "OVERDUE FOLLOW-UPS")}</table></td></tr>
    <tr><td style="padding:18px 24px 0;font-size:13px;line-height:1.65;color:#6B7A88;"><strong style="color:#0A2540;">${closedYtd.length} Closed YTD &nbsp; / &nbsp; ${fmtM(closedYtdValue)}</strong>${closedYtdEstimated ? `<br/>${closedYtdEstimated} without a recorded closing price; value may use contract or offer estimates.` : ""}</td></tr>
    <tr><td style="padding:24px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #DDE4EB;border-collapse:collapse;">
      <tr><td colspan="2" style="padding:16px;border-top:3px solid #4E9FD6;"><div style="font-size:10px;letter-spacing:1.5px;color:#6B7A88;font-weight:700;">OFFER ACTIVITY</div><h2 style="margin:6px 0;font-size:18px;color:#0A2540;">Offers Out / Last 7 Days</h2><p style="margin:0;font-size:12px;color:#6B7A88;">${offerWindowStart} through ${today} &middot; Central Time</p></td></tr>
      <tr>${stat(String(recentOffers.length), "OFFERS LOGGED", 50)}${stat(recentOfferValue.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }), "TOTAL OFFER VALUE", 50)}</tr>
      <tr><td colspan="2" style="padding:14px 16px;font-size:12px;line-height:1.65;color:#6B7A88;"><strong style="color:#0A2540;">$${recentOfferValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong> in recorded offer value.${unpricedOffers ? ` ${unpricedOffers} offer${unpricedOffers === 1 ? " has" : "s have"} no recorded price and ${unpricedOffers === 1 ? "is" : "are"} excluded from the value.` : ""}<br/>Based on dated entries in the offer log; revisions count separately. <a href="${APP_URL}/offers?range=7d" style="color:#0E5AA7;">View offers</a></td></tr>
    </table></td></tr>
    <tr><td style="padding:24px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #DDE4EB;border-collapse:collapse;"><tr><td style="padding:16px;border-top:3px solid #4E9FD6;"><div style="font-size:10px;letter-spacing:1.5px;color:#6B7A88;font-weight:700;">PIPELINE SNAPSHOT</div><h2 style="margin:6px 0 0;font-size:18px;color:#0A2540;">Where Our Deals Stand</h2><p style="margin:6px 0 0;font-size:12px;color:#6B7A88;">Deal counts by stage. Bars scaled within each pipeline.</p></td></tr>${pipeline}</table></td></tr>
    ${section(`Call For Offers <span style="font-size:12px;color:#6B7A88;"> / ${callsForOffers.length}</span>`, callsForOffers.map(offerDeadlineLine), "No upcoming call-for-offers dates entered.")}
    ${section(`DD Expirations &amp; Closings / Next 7 Days (${milestones.length})`, milestones.map(milestoneLine), "No DD deadlines or closings in the next 7 days.")}
    ${section(`Diligence Deadlines / Next 7 Days (${diligence.length})`, diligence.map(diligenceLine), "No diligence deadlines in the next 7 days.")}
    <tr><td style="padding:24px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #DDE4EB;border-collapse:collapse;"><tr><td colspan="4" style="padding:16px;border-top:3px solid #4E9FD6;font-size:17px;font-weight:700;color:#0A2540;">Team Workload</td></tr><tr>${["Owner", "Active", "Due / 7D", "Stale"].map(label => `<th align="${label === "Owner" ? "left" : "center"}" style="padding:10px;font-size:10px;letter-spacing:.5px;color:#6B7A88;">${label}</th>`).join("")}</tr>${ownerRows || '<tr><td colspan="4" style="padding:16px;font-size:13px;color:#6B7A88;">No active deals.</td></tr>'}</table></td></tr>
    ${section(`Overdue Follow-ups (${overdue.length})`, overdue.map(overdueLine), "Nothing overdue.")}
    ${section(`Targets Ready For Re-approach (${targetsDue.length})`, targetsDue.map((d: any) => `<li>${dealLink(d)} &mdash; follow up ${d.follow_up_on}${d.pursuit_score ? ` &middot; Pursuit score: ${d.pursuit_score}/5` : ""}</li>`), "No targets due.")}
    ${section(`Stale Deals / No Touch In 14+ Days (${stale.length})`, stale.map((d: any) => `<li>${dealLink(d)} &mdash; ${d.staleDays} days &middot; ${STAGE_LABELS[d.stage] ?? d.stage}</li>`), "Nothing stale.")}
    ${section(`Lease Expirations / Next 180 Days (${expiring.length})`, expiring.map(leaseLine), "No leases ending in the next six months.")}
    <tr><td align="center" style="padding:28px 24px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#0E5AA7" style="padding:14px 24px;border-radius:3px;"><a href="${APP_URL}/" style="font-size:12px;font-weight:700;letter-spacing:1px;color:#FFFFFF;text-decoration:none;">OPEN HOPPER</a></td></tr></table><p style="font-size:11px;line-height:1.6;color:#6B7A88;margin:18px 0 0;">Central Acquisitions &middot; Dalfen Industrial<br/>Dates use Central Time. Deadline counts include overdue items.<br/>Review the linked deal for the latest details.</p></td></tr>
  </table></td></tr></table>`;

  // Milestones lead the subject line: a closing in 3 days is the one thing
  // that has to survive being read on a phone lock screen.
  const subjectParts = [
    offersTomorrow.length ? `${offersTomorrow.length} call for offers TOMORROW` : null,
    callsForOffers.some(d => d.daysAway === 0) ? "call for offers TODAY" : null,
    milestones.length ? `${milestones.length} DD/closing in 7d` : null,
    diligence.length ? `${diligence.length} diligence due` : null,
    `${overdue.length} overdue`,
    `${targetsDue.length} targets due`,
    `${stale.length} stale`,
  ].filter(Boolean);
  const subject = `Central Acquisitions brief — ${subjectParts.join(" · ")}`;

  return {
    subject,
    html,
    counts: {
      callsForOffers: callsForOffers.length,
      offersTomorrow: offersTomorrow.length,
      milestones: milestones.length,
      diligence: diligence.length,
      leaseExpirations: expiring.length,
      overdue: overdue.length,
      targetsDue: targetsDue.length,
      stale: stale.length,
      closedYtd: closedYtd.length,
      offersLast7Days: recentOffers.length,
      offerValueLast7Days: recentOfferValue,
      unpricedOffersLast7Days: unpricedOffers,
    },
  };
}
