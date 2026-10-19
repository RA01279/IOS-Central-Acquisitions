// lib/agents/market-narrative.ts
//
// The "market-narrative" agent: write the market (or submarket) story from
// the broker reports on file and Hopper's own comps -- what the brokers
// agree on, where they differ, how recent comps compare, and what it means
// for IOS / industrial acquisitions. Every point cites its sources by the
// labels Hopper supplied (R1, R2... for reports, "Hopper comps"). Pure, for
// the test.

export const MARKET_NARRATIVE_INSTRUCTIONS = `Write the market narrative for the market or submarket named in the supplied evidence. The evidence lists broker market reports (labelled R1, R2, ... with publisher, period, statistics, summary and takeaways) and, when available, Hopper's own lease and sale comps for the area (labelled "Hopper comps"). The report field MUST be a serialized JSON object, nothing else:
{"headline":string,"narrative":string,"points":[{"text":string,"sources":[string]}],"conflicts":[string],"gaps":[string]}
Rules:
- Use only the supplied evidence. No outside data, no web search, no invented figures. Quote numbers exactly as the source gives them, with the period ("vacancy 2.3% in Q2 2026 (R1)"). Write money with commas and units ("$6,600 per acre per month", "$1.07M per acre"), square feet with commas ("150,000 SF").
- headline: one sentence on where the market stands.
- narrative: 2-4 short paragraphs, plain prose for an acquisitions team buying industrial outdoor storage and small-bay industrial: supply and vacancy, demand and leasing, rents and pricing, construction pipeline, and what it means for acquiring and leasing up here. Cite inline with the labels in parentheses, e.g. (R1), (R2, Hopper comps).
- points: 4-8 key facts or takeaways, each with sources = the labels it rests on (at least one).
- Favour the most recent report when figures differ, and say so; list real disagreements between sources, or between brokers and Hopper's comps, in conflicts.
- gaps: what the evidence doesn't cover that the team would want (e.g. no IOS-specific rent data, no sale comps in the last 12 months).
- If only one report is supplied, say the narrative rests on a single source.`;

export type MarketNarrative = {
  headline: string;
  narrative: string;
  points: { text: string; sources: string[] }[];
  conflicts: string[];
  gaps: string[];
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Strict parse; null unless every point cites at least one supplied label. */
export function parseMarketNarrative(report: string, labels?: string[]): MarketNarrative | null {
  let raw: any;
  try {
    raw = JSON.parse(String(report ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const headline = str(raw?.headline, 400);
  const narrative = str(raw?.narrative, 8000);
  if (!headline || !narrative) return null;
  const known = labels ? new Set(labels) : null;
  const points = (Array.isArray(raw.points) ? raw.points : []).slice(0, 12).map((p: any) => ({
    text: str(p?.text, 600),
    sources: (Array.isArray(p?.sources) ? p.sources : []).map((s: any) => str(s, 40)).filter((s: string) => s && (!known || known.has(s))),
  }));
  if (!points.length || points.some((p: any) => !p.text || !p.sources.length)) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 600)).filter(Boolean).slice(0, 12) : []);
  return { headline, narrative, points, conflicts: list(raw.conflicts), gaps: list(raw.gaps) };
}
