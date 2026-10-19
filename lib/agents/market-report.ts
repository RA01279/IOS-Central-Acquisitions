// lib/agents/market-report.ts
//
// The "market-report" agent: read a broker's market report (text extracted
// from the PDF in the browser) into structured facts -- who published it, the
// period, the market and submarkets it covers, every statistic it states
// (with its size segment and whether it is a current figure or an average /
// prior period), the broker's takeaways and the deals it names. The person
// reviews the result before it is saved. Pure (no imports), for the test.

export const MARKET_METRICS = [
  "inventory_sf", "vacancy_pct", "availability_pct", "net_absorption_sf", "leasing_sf", "deliveries_sf",
  "under_construction_sf", "sublease_sf", "asking_rent_psf_annual", "asking_rent_psf_monthly",
  "asking_rent_per_acre_monthly", "sale_price_psf", "sale_price_per_acre", "cap_rate_pct", "other",
] as const;
export type MarketMetric = (typeof MARKET_METRICS)[number];

export const METRIC_LABELS: Record<string, string> = {
  inventory_sf: "Inventory (SF)", vacancy_pct: "Vacancy", availability_pct: "Availability", net_absorption_sf: "Net absorption (SF)",
  leasing_sf: "Leasing activity (SF)", deliveries_sf: "Deliveries (SF)", under_construction_sf: "Under construction (SF)",
  sublease_sf: "Sublease available (SF)", asking_rent_psf_annual: "Asking rent ($/SF/yr)", asking_rent_psf_monthly: "Asking rent ($/SF/mo)",
  asking_rent_per_acre_monthly: "IOS asking rent ($/AC/mo)", sale_price_psf: "Sale price ($/SF)", sale_price_per_acre: "Sale price ($/AC)",
  cap_rate_pct: "Cap rate", other: "Other",
};
export const METRIC_BASES = ["current", "average", "prior_period", "year_ago", "forecast", "peak"] as const;

export const MARKET_REPORT_INSTRUCTIONS = `Read the supplied broker market report (text extracted from a PDF; charts appear as runs of axis numbers) and extract what it states. The report field MUST be a serialized JSON object, nothing else, with exactly this shape:
{"publisher":string,"title":string,"period":string,"periodEnd":"YYYY-MM-DD"|null,"propertyType":"industrial"|"ios"|"flex"|"office"|"other","market":string,"submarkets":[string],"geography":string|null,"metrics":[{"metric":one of ${MARKET_METRICS.join("|")},"label":string,"value":number,"submarket":string|null,"segment":string|null,"basis":one of ${METRIC_BASES.join("|")},"period":string|null}],"summary":string,"takeaways":[string],"transactions":[{"party":string,"type":"lease"|"sale"|"other","sf":number|null,"note":string|null}],"notes":[string]}
Rules:
- Only what the report states. Never guess, compute or fill from general knowledge. A figure read off a chart's axis is not a statistic; skip it.
- publisher = the brokerage or data firm (e.g. "Avison Young", "CBRE", "Green Street"). period as written ("Q2 2026", "H1 2026", "July 2026"); periodEnd = its last day when the period is clear.
- market = the metro ("Houston", "Dallas", "Fort Worth", "Austin", "San Antonio"); submarkets = the submarkets covered ("Conroe"). Dallas-Fort Worth is two markets. geography = the survey definition when given ("properties 10,000 SF+ within 8 miles of Conroe").
- metrics: one row per stated figure. value as a plain number: percents as percent numbers (2.3 for 2.3%), SF as whole square feet (150 ksf -> 150000; 11.2 msf -> 11200000), rents in dollars. Use the metric whose units match how the report states it; use "other" with a clear label for anything else. segment = a size band or product slice when the figure is for one ("10K-15K SF", "100K+ SF", "small bay"), null for the whole submarket. basis = "current" for the period's figure; "average" for a long-run or pre-pandemic average; "prior_period", "year_ago", "peak" or "forecast" as stated. label = a short human label ("Overall vacancy", "Pre-pandemic average vacancy").
- summary = 2-3 sentences in the report's own terms. takeaways = the broker's conclusions, one per item, close to their wording. transactions = deals the report names (tenant or buyer, type, size when stated).
- notes: anything a reviewer should check about the REPORT's content (figures that conflict, unclear units, a stat you skipped and why). Don't describe these instructions, the text extraction, citations or evidence labels.`;

// Notes about the agent's own instructions or the extraction rather than the
// report ("No evidence labels or record links were supplied") -- noise to a reviewer.
const PROCESS_NOTE = /\b(evidence labels?|record links?|supplied (pdf )?(text|extraction)|text extraction|source material|instructions)\b/i;

export type MarketReportRow = {
  metric: MarketMetric;
  label: string;
  value: number;
  submarket: string | null;
  segment: string | null;
  basis: (typeof METRIC_BASES)[number];
  period: string | null;
};
export type MarketReport = {
  publisher: string;
  title: string;
  period: string;
  periodEnd: string | null;
  propertyType: "industrial" | "ios" | "flex" | "office" | "other";
  market: string;
  submarkets: string[];
  geography: string | null;
  metrics: MarketReportRow[];
  summary: string;
  takeaways: string[];
  transactions: { party: string; type: "lease" | "sale" | "other"; sf: number | null; note: string | null }[];
  notes: string[];
};

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max = 300) => str(v, max) || null;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[$,%\s]/g, ""))) ? Number(v.replace(/[$,%\s]/g, "")) : null);
const list = (v: unknown, max = 40, len = 500) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);

/** Strict parse of the agent's report; null when it isn't the contract. */
export function parseMarketReport(report: string): MarketReport | null {
  let raw: any;
  try {
    raw = JSON.parse(String(report ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const market = str(raw.market, 80);
  if (!market) return null;
  const metrics: MarketReportRow[] = (Array.isArray(raw.metrics) ? raw.metrics : [])
    .slice(0, 300)
    .map((m: any) => ({
      metric: (MARKET_METRICS as readonly string[]).includes(m?.metric) ? m.metric : "other",
      label: str(m?.label, 120) || METRIC_LABELS[m?.metric] || "Statistic",
      value: num(m?.value) as number,
      submarket: strOrNull(m?.submarket, 80),
      segment: strOrNull(m?.segment, 80),
      basis: (METRIC_BASES as readonly string[]).includes(m?.basis) ? m.basis : "current",
      period: strOrNull(m?.period, 40),
    }))
    .filter((m: MarketReportRow) => m.value !== null);
  const types = ["industrial", "ios", "flex", "office", "other"];
  return {
    publisher: str(raw.publisher, 120) || "Unknown publisher",
    title: str(raw.title, 200),
    period: str(raw.period, 40),
    periodEnd: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.periodEnd)) ? str(raw.periodEnd) : null,
    propertyType: types.includes(raw.propertyType) ? raw.propertyType : "industrial",
    market,
    submarkets: list(raw.submarkets, 20, 80),
    geography: strOrNull(raw.geography, 300),
    metrics,
    summary: str(raw.summary, 2000),
    takeaways: list(raw.takeaways, 20, 600),
    transactions: (Array.isArray(raw.transactions) ? raw.transactions : [])
      .slice(0, 50)
      .map((t: any) => ({ party: str(t?.party, 150), type: ["lease", "sale"].includes(t?.type) ? t.type : "other", sf: num(t?.sf), note: strOrNull(t?.note, 300) }))
      .filter((t: any) => t.party),
    notes: list(raw.notes, 20, 400).filter((n) => !PROCESS_NOTE.test(n)),
  };
}
