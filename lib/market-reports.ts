// lib/market-reports.ts
//
// SERVER ONLY. Broker market reports on file, and the evidence pack the
// market-narrative agent writes from: the reports covering a market or
// submarket (labelled R1, R2... newest first) with their statistics, summary
// and takeaways, plus Hopper's own recent comps for the same area.

import { getServiceClient } from "./supabase";
import { loadCompEvidence } from "./comps/evidence";
import { rateViews } from "./comps/rates";
import { canonicalMarket } from "./markets";
import { METRIC_LABELS, type MarketReport } from "./agents/market-report";

export const REPORT_COLUMNS = "id, publisher, title, period, period_end, property_type, market, submarkets, geography, summary, takeaways, transactions, notes, storage_path, file_name, pages, uploaded_by, created_at";

const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Does a report cover this submarket (or, with no submarket, this market at all)? */
export function covers(report: { market: string; submarkets: string[] | null }, market: string, submarket: string | null) {
  if (lc(report.market) !== lc(market)) return false;
  if (!submarket) return true;
  const subs = (report.submarkets ?? []).map(lc);
  return !subs.length || subs.includes(lc(submarket));
}

export async function listReports() {
  const { data, error } = await getServiceClient().from("market_reports").select(REPORT_COLUMNS).order("period_end", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`Loading market reports: ${error.message}`);
  return data ?? [];
}

export async function listMetrics(reportIds: string[]) {
  if (!reportIds.length) return [];
  const { data, error } = await getServiceClient().from("market_report_metrics").select("report_id, market, submarket, segment, metric, label, value, basis, period, period_end").in("report_id", reportIds).limit(5000);
  if (error) throw new Error(`Loading report statistics: ${error.message}`);
  return data ?? [];
}

/** Save a reviewed report and its statistics. Market names go through canonicalMarket. */
export async function saveReport(r: MarketReport, file: { path: string; name: string; pages: number | null }, actor: string) {
  const db = getServiceClient();
  const market = canonicalMarket(r.market, r.submarkets[0]) ?? r.market;
  const { data: row, error } = await db
    .from("market_reports")
    .insert({
      publisher: r.publisher, title: r.title || null, period: r.period || null, period_end: r.periodEnd, property_type: r.propertyType,
      market, submarkets: r.submarkets, geography: r.geography, summary: r.summary || null, takeaways: r.takeaways,
      transactions: r.transactions, notes: r.notes, storage_path: file.path, file_name: file.name, pages: file.pages, uploaded_by: actor,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (r.metrics.length) {
    const { error: mErr } = await db.from("market_report_metrics").insert(
      r.metrics.map((m) => ({
        report_id: row.id, market, submarket: m.submarket ?? (r.submarkets.length === 1 ? r.submarkets[0] : null), segment: m.segment,
        metric: m.metric, label: m.label, value: m.value, basis: m.basis, period: m.period ?? r.period ?? null, period_end: r.periodEnd,
      }))
    );
    if (mErr) {
      await db.from("market_reports").delete().eq("id", row.id);
      throw new Error(`Saving the statistics: ${mErr.message}`);
    }
  }
  return row.id as string;
}

/** Hopper's own comps for the area, summarised for the narrative. */
export async function compSummary(market: string, submarket: string | null) {
  const comps = (await loadCompEvidence()) as any[];
  const since = new Date(Date.now() - 24 * 30.44 * 86400000).toISOString().slice(0, 10);
  const inArea = comps.filter((c) => lc(c.market) === lc(market) && (!submarket || lc(c.submarket) === lc(submarket) || lc(c.city) === lc(submarket)));
  const recent = inArea.filter((c) => (c.date_commenced ?? c.closed_on ?? "") >= since);
  const leases = recent.filter((c) => c.comp_type === "lease");
  const sales = recent.filter((c) => c.comp_type === "sale");
  const ios = (c: any) => c.asset_class !== "industrial";
  const perAcre = leases.filter(ios).map((c) => rateViews(c).perAcreMonthly).filter((v): v is number => v != null);
  const perSfYr = leases.filter((c) => !ios(c)).map((c) => rateViews(c).perSfBldgAnnual).filter((v): v is number => v != null);
  const saleAcre = sales.filter((c) => c.lot_sf && c.sale_price).map((c) => Number(c.sale_price) / (Number(c.lot_sf) / 43560));
  return {
    scope: submarket ? `${submarket} (${market}), comps tagged with that submarket or city` : `${market} market`,
    window: "last 24 months",
    leaseComps: leases.length,
    saleComps: sales.length,
    iosMedianRentPerAcreMonthly: median(perAcre) != null ? Math.round(median(perAcre)!) : null,
    industrialMedianRentPerSfAnnual: median(perSfYr) != null ? Math.round(median(perSfYr)! * 100) / 100 : null,
    medianSalePricePerAcre: median(saleAcre) != null ? Math.round(median(saleAcre)!) : null,
    recent: recent
      .sort((a, b) => String(b.date_commenced ?? b.closed_on).localeCompare(String(a.date_commenced ?? a.closed_on)))
      .slice(0, 15)
      .map((c) => ({
        type: c.comp_type, date: c.date_commenced ?? c.closed_on, address: c.address, city: c.city, class: ios(c) ? "IOS" : "industrial",
        acres: c.lot_sf ? Math.round((Number(c.lot_sf) / 43560) * 100) / 100 : null, buildingSf: c.building_sf ?? null,
        rentPerAcreMonthly: c.comp_type === "lease" ? rateViews(c).perAcreMonthly : null,
        rentPerSfAnnual: c.comp_type === "lease" ? rateViews(c).perSfBldgAnnual : null,
        salePrice: c.sale_price ?? null,
      })),
  };
}

/** The evidence pack for one market / submarket narrative, and the labels it cites. */
export async function narrativeEvidence(marketIn: string, submarketIn: string | null) {
  const market = canonicalMarket(marketIn) ?? marketIn;
  const submarket = submarketIn?.trim() || null;
  const reports = (await listReports()).filter((r: any) => covers(r, market, submarket)).slice(0, 8);
  const metrics = await listMetrics(reports.map((r: any) => r.id));
  const sources = reports.map((r: any, i: number) => ({ label: `R${i + 1}`, reportId: r.id, publisher: r.publisher, period: r.period }));
  const comps = await compSummary(market, submarket);
  const evidence = {
    area: { market, submarket },
    reports: reports.map((r: any, i: number) => ({
      label: `R${i + 1}`,
      publisher: r.publisher,
      title: r.title,
      period: r.period,
      periodEnd: r.period_end,
      propertyType: r.property_type,
      submarkets: r.submarkets,
      geography: r.geography,
      summary: r.summary,
      takeaways: r.takeaways,
      transactions: r.transactions,
      statistics: metrics
        .filter((m: any) => m.report_id === r.id)
        .map((m: any) => ({ label: m.label || METRIC_LABELS[m.metric], metric: m.metric, value: Number(m.value), submarket: m.submarket, segment: m.segment, basis: m.basis, period: m.period })),
    })),
    hopperComps: { label: "Hopper comps", ...comps },
  };
  const labels = [...sources.map((s) => s.label), "Hopper comps"];
  return { market, submarket, reports, sources, labels, text: JSON.stringify(evidence).slice(0, 95000) };
}
