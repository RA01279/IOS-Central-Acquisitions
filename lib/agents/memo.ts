// Content contract shared by the model prompt, report preview and PPTX exporter.
// The reference supplies structure/design only, never another deal's facts.
export const MEMO_VERSION = "exec-summary-v1";
export const MEMO_SLIDES = [
  ["Executive Summary", "Property address, preparation month/year, cover aerial."],
  ["Overview", "Overview, business plan, financing, exit optionality. Key metrics table: building SF, acres, occupancy, purchase price, all-in cost, going-in yield, exit cap, IRR, equity multiple, hold months. Name each SF denominator."],
  ["Market Demographics", "Market population, household/income, employment and employer evidence. Dated demographic exhibit."],
  ["Market Demographics", "Submarket rankings and historical asset-value evidence. Dated supporting exhibit."],
  ["Population Growth vs Other Markets", "Comparable population growth forecasts, matching years and methodology; map exhibit."],
  ["Valuation vs Peer Markets", "Peer-market table: nominal/economic cap rate, capex reserve, intermediate/long-term NOI growth, unlevered/risk-adjusted IRR, risk/liquidity/momentum adjustments. Use only supplied research; no default percentages."],
  ["Market Overview", "Supply, vacancy, absorption, rents, jobs and small-building dynamics. Keep survey periods and geographic coverage explicit."],
  ["Market Overview — Submarket", "Subject submarket leasing and rent evidence; submarket map."],
  ["Market Map", "Subject position in its own market; identify address and verified road/access context. Requires a deal-specific map."],
  ["Submarket Map", "Closer subject-location map with access and building inset if available."],
  ["Zoning", "Verified zoning district, outdoor-storage rules, permitted/conditional uses, access and unresolved verification. Cite ordinance or research; map alone is not a determination."],
  ["Site Overview", "Building SF, gross and usable acres separately, improvements, occupancy and parcel boundaries. Annotated subject aerial."],
  ["Tenant Overview", "Tenant business, history, ownership, services, scale and use of the property. Distinguish supplied estimates from verified financials; do not assert creditworthiness."],
  ["Model — Base Case", "Approved model's recorded inputs and returns, model version/date, capitalization and financing. Never recreate a workbook or calculate IRR from incomplete inputs."],
  ["Market Leasing Assumptions — Base Case", "Rent roll/MLA: tenant, SF, lease dates, remaining term/WALT, renewal, downtime, TI/LC, in-place rent, market rent, re-leasing rent. Label building-vs-land SF and annual-vs-monthly units."],
  ["Cash Flow — Base Case", "Actual supplied approved-model annual cash flows. Do not infer annual cash flows from summary returns."],
  ["Sensitivities — Exit Cap, Purchase Price and Hold Period", "Actual supplied sensitivity outputs for exit cap and purchase price, split by supported hold periods. Missing scenario outputs stay missing; no synthetic grids."],
  ["Competitive Set", "Relevant competing IOS availability table: address, status/date, size, yard, asking rent/price and comments. Do not call closed comps current availability."],
  ["Competitive Set — Map", "Map of the same competitive set, with matching names/numbering."],
  ["Lease Comps", "Relevant lease table: address, signed/asking status, date, building SF, land acres, rent and explicit unit/time basis, term and comments. Cite every record."],
  ["Lease Comps — Map", "Map and legend matching the lease table."],
  ["Sale Comps", "Relevant sale table: address, closed/asking status, date, building SF, land acres, price, explicit price/SF denominator, lease/cap-rate context and comments."],
  ["Sale Comps — Map", "Map and legend matching the sale table."],
  ["Pursuit Terms", "Table: purchase price, initial/total deposit, due diligence days, closing days, estimated DD expiration/closing dates, diligence budget. Do not turn offers into accepted terms."],
  ["Due Diligence Budget", "Table: deposits and cost lines (Phase I, zoning, title, legal, other) and total; partner allocation only if supplied. Keep refundable deposit separate from diligence expense."],
] as const;

export type MemoSlide = { number: number; title: string; bullets: string[]; columns: string[]; rows: string[][]; sources: string[]; missing: string[] };
export type MemoDeck = { version: typeof MEMO_VERSION; property: string; date: string; slides: MemoSlide[] };

export function parseMemo(text: string): MemoDeck | null {
  try {
    const d = JSON.parse(text);
    const str = (s: unknown, n: number) => typeof s === "string" && s.length <= n;
    const list = (a: unknown, count: number, len: number): a is string[] => Array.isArray(a) && a.length <= count && a.every(s => str(s, len));
    if (d.version !== MEMO_VERSION || !str(d.property, 150) || !d.property.trim() || !str(d.date, 60) || !Array.isArray(d.slides) || d.slides.length !== 25) return null;
    for (const [i, s] of d.slides.entries()) {
      if (!s || s.number !== i + 1 || !str(s.title, 110) || !s.title.trim() || !list(s.bullets, 6, 260) || !list(s.columns, 8, 50) || !list(s.sources, 12, 500) || !list(s.missing, 8, 200) || !Array.isArray(s.rows) || s.rows.length > 12 || s.rows.some((r: unknown) => !list(r, 8, 100) || r.length !== s.columns.length) || (s.rows.length && !s.columns.length)) return null;
    }
    return d;
  } catch { return null; }
}

export const MEMO_INSTRUCTIONS = `Produce an editable PowerPoint executive-summary content plan matching the user's 25-slide 12803 O'Connor reference, with the exact slide order below. Adapt market and property names to the selected deal. The reference is a layout only: never reuse its tenant, property, returns, dates, market numbers, partner allocations or map imagery.
The outer response is still JSON {report,model,limitations}. For this agent ONLY, report must be a STRING containing serialized JSON (no Markdown fences) with this exact shape:
{"version":"${MEMO_VERSION}","property":"subject address","date":"Month Year","slides":[{"number":1,"title":"Executive Summary","bullets":[],"columns":[],"rows":[],"sources":[],"missing":[]}, ... exactly 25 slides]}.
Every slide must contain ALL seven fields. Use plain text without Markdown formatting. Max title 110 characters; 6 bullets of at most 260 characters each; 8 columns of at most 50 characters; 12 rows with every cell at most 100 characters, each row matching the column count; 12 source strings of at most 500 characters; 8 missing strings of at most 200 characters. Keep total bullet copy under 850 characters per slide (under 650 for slides 2, 8, 11, 12, 13). Concise headings inside bullets are welcome. Include source labels/record URLs and dates in sources, supporting every quantitative claim. Use compact source keys in table cells when needed. Further explanation belongs in sources, not oversized slide text.
Tables must use explicit headers and unit labels. Summarize to fit; choose the most relevant comps and disclose truncation. Missing facts are 'Not provided', not zero. Put missing visual/model exhibit requests in missing. Keep unsupported tables empty rather than fill a fabricated dataset. Map slides identify the required map and matching records; no invented maps or coordinates. The app lets the user add PNG/JPEG exhibits separately. Previously generated agent reports are unverified drafts: use their citations, preserve their caveats and dates, and surface contradictions with primary deal/model evidence.
This is a draft for review, never investment approval. Distinguish proposed terms, recorded assumptions, and approved-model outputs. Flag inconsistent units or prices rather than silently reconcile them. Do not invent financial outputs or repeat claims about another property. Keep sources and unresolved diligence in the relevant slide's notes/missing fields.
SLIDE ORDER:\n${MEMO_SLIDES.map(([title, content], i) => `${i + 1}. ${title}: ${content}`).join("\n")}`;
