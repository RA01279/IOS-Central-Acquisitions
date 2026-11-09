import { addDays, daysBetween } from "./summary";
import { callForOffersDate, offerRoundLabel, type CfoTask } from "./call-for-offers";

export interface OfferDeadlineDeal {
  id: string;
  stage: string;
  call_for_offers_on?: string | null;
  offer_round?: number | null;
  tasks?: CfoTask[] | null;
  assigned_analyst?: string | null;
  properties?: { address?: string | null } | null;
}

// Postgres date values are CT calendar dates, not instants. Noon-UTC math
// preserves a one-calendar-day reminder across both DST transitions.
export function offerDeadlines<T extends OfferDeadlineDeal>(deals: T[], today: string) {
  return deals.map(d => ({ ...d, date: callForOffersDate(d) }))
    .filter((d): d is typeof d & { date: string } => d.stage !== "closed" && d.stage !== "archived" && !!d.date && d.date >= today)
    .map(d => ({ ...d, daysAway: daysBetween(today, d.date) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function dayBeforeOffers<T extends OfferDeadlineDeal>(deals: T[], today: string) {
  return offerDeadlines(deals, today).filter(d => d.date === addDays(today, 1));
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function offerDeadlineLine(d: ReturnType<typeof offerDeadlines>[number]) {
  const when = d.daysAway === 0 ? "TODAY" : d.daysAway === 1 ? "TOMORROW" : `in ${d.daysAway} days`;
  return `<li><a href="https://ios-central-acquisitions.vercel.app/deals/${encodeURIComponent(d.id)}" style="color:#0E5AA7;">${esc(d.properties?.address ?? "Untitled")}</a>${(d.offer_round ?? 1) > 1 ? ` (${esc(offerRoundLabel(d.offer_round))})` : ""} &mdash; ${d.date}, <strong>${when}</strong>${d.assigned_analyst ? ` &middot; ${esc(d.assigned_analyst)}` : ""}</li>`;
}

export function composeOfferReminder(deals: OfferDeadlineDeal[], today: string) {
  const due = dayBeforeOffers(deals, today);
  if (!due.length) return null;
  return {
    subject: `Call for offers tomorrow — ${due.length} deal${due.length === 1 ? "" : "s"} (${due[0].date})`,
    html: `<div style="font-family:'Public Sans',Arial,sans-serif;max-width:640px;color:#364049;line-height:1.6;"><p style="color:#4E9FD6;font-size:12px;font-weight:700;letter-spacing:.14em;">CENTRAL ACQUISITIONS</p><h2 style="font-family:Archivo,Arial,sans-serif;color:#0A2540;">Call For Offers Tomorrow</h2><div style="width:56px;height:4px;background:#4E9FD6;"></div><p>Offers are due tomorrow, ${due[0].date}. Review the deal and prepare our submission.</p><ul>${due.map(offerDeadlineLine).join("")}</ul><p style="color:#6B7A88;font-size:12px;">Dates use Central Time. Sent to our daily brief recipients.</p></div>`,
    count: due.length,
  };
}
