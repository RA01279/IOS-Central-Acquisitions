// lib/ic-deck/model.ts
//
// Pulls the IC-deck numbers out of a Dalfen acquisition model (the "UW -
// CURRENT" workbook). Cells are found by their row labels, not fixed
// addresses, so a row inserted in one deal's model doesn't shift every figure.
//
// Two rules, because this feeds an investment committee:
//  1. Figures are copied exactly as the model last calculated them. Nothing is
//     recomputed here except plain arithmetic the deck needs to display (PSF,
//     coverage), and those are labelled.
//  2. Anything that doesn't reconcile is reported as a warning rather than
//     fixed. The model template carries hidden sheets from older deals and
//     what-if tables that only refresh on a full recalc; copying those
//     silently is how a stale number reaches IC.

import { excelDate, numberToCol, type CellValue, type Sheet, type Workbook } from "./xlsx-lite";

export const MODEL_VERSION = "dalfen-uw-v1";

export interface Money { amount: number | null; psf: number | null }
export interface Ret { irr: number | null; multiple: number | null }
export interface Grid {
  title: string;
  /** Row axis, e.g. purchase price; column axis, e.g. exit cap. */
  rowLabel: string;
  colLabel: string;
  cols: number[];
  rows: Array<{ key: number; cells: string[] }>;
}
export interface RentRollRow {
  tenant: string;
  suite: string | null;
  sf: number | null;
  pctSf: number | null;
  start: string | null;
  expiration: string | null;
  remainingMonths: number | null;
  mla: string | null;
  renewalPct: number | null;
  downtimeMonths: number | null;
  sbrAnnual: number | null;
  sbrPsfMonthly: number | null;
  marketAnnual: number | null;
  marketPsfMonthly: number | null;
  newLeaseAnnual: number | null;
}
export interface CashFlowRow { label: string; values: Array<number | null>; emphasis?: boolean; format?: "pct" }

export interface ModelSummary {
  version: typeof MODEL_VERSION;
  source: { fileName: string; modelDate: string | null };
  property: {
    address: string | null;
    cityState: string | null;
    state: string | null;
    acres: number | null;
    siteSf: number | null;
    buildingSf: number | null;
    coverage: number | null;
  };
  capitalization: Array<{ label: string } & Money>;
  totalCost: Money;
  yields: { goingIn: number | null; returnOnCostAtExit: number | null; exitCap: number | null };
  returns: { holdYears: number | null; levered: Ret; unlevered: Ret; lp: Ret; profit: number | null };
  dates: { acquisition: string | null; sale: string | null };
  debt: {
    loan: number | null; equity: number | null; ltpp: number | null; ltc: number | null;
    index: number | null; spread: number | null; interestOnlyMonths: number | null; amortizationMonths: number | null;
  };
  leasing: Array<{ label: string; value: string }>;
  rentRoll: { rows: RentRollRow[]; totalSf: number | null; waltYears: number | null };
  cashFlow: { years: string[]; rows: CashFlowRow[] };
  sensitivities: { deal: Grid | null; lp: Grid | null };
  warnings: string[];
}

const SQFT_PER_ACRE = 43560;
const num = (v: CellValue): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: CellValue): string | null => (v === null || v === undefined ? null : String(v).trim() || null);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** First cell (optionally in one column, after a row) whose text matches. */
function find(sheet: Sheet | null, label: RegExp, opts: { col?: number; after?: number; before?: number } = {}) {
  if (!sheet) return null;
  for (const c of sheet.cells()) {
    if (opts.col && c.col !== opts.col) continue;
    if (opts.after && c.row <= opts.after) continue;
    if (opts.before && c.row >= opts.before) continue;
    if (typeof c.value === "string" && label.test(c.value.trim())) return c;
  }
  return null;
}
/** The value N columns to the right of a label in column B. */
function right(sheet: Sheet | null, label: RegExp, offset: number, opts: { after?: number; before?: number } = {}): CellValue {
  const hit = find(sheet, label, { col: 2, ...opts });
  return hit && sheet ? sheet.at(hit.row, hit.col + offset) : null;
}
const pct = (v: number | null, d = 2) => (v === null ? "—" : `${(v * 100).toFixed(d)}%`);
const fmtRet = (r: Ret) => (r.irr === null || r.multiple === null ? null : `${(r.irr * 100).toFixed(2)}% / ${r.multiple.toFixed(1)}x`);

export function extractModel(book: Workbook, fileName: string): ModelSummary {
  const warnings: string[] = [];
  const es = book.sheet("ES Summary");
  const pf = book.sheet("Pro Forma");
  const dov = book.sheet("Deal Overview");
  const rr = book.sheet("Rent Roll");
  const mpf = book.sheet("Memo Pro Forma");
  const missing = [["ES Summary", es], ["Pro Forma", pf], ["Deal Overview", dov], ["Rent Roll", rr], ["Memo Pro Forma", mpf]]
    .filter(([, s]) => !s).map(([n]) => n);
  if (missing.length) {
    throw new Error(`This doesn't look like a Dalfen acquisition model: missing the ${missing.join(", ")} sheet${missing.length > 1 ? "s" : ""}.`);
  }

  // ---- Property (ES Summary is the visible, deck-facing summary) ----------
  const address = str(right(es, /^Address$/i, 2));
  const acres = num(right(es, /^Portfolio Size|^Site Size|^Acres/i, 2));
  const esSiteSf = num(right(es, /^Site SF$/i, 2));
  const buildingSf = num(right(es, /^Building SF$/i, 2));
  let siteSf = esSiteSf;
  if (acres && esSiteSf && Math.abs(esSiteSf - acres * SQFT_PER_ACRE) / (acres * SQFT_PER_ACRE) > 0.05) {
    siteSf = Math.round(acres * SQFT_PER_ACRE);
    warnings.push(`ES Summary Site SF (${esSiteSf.toLocaleString("en-US")}) doesn't match ${acres} acres (${siteSf.toLocaleString("en-US")} SF). The deck uses the acreage; fix Site SF in the model.`);
  } else if (!siteSf && acres) siteSf = Math.round(acres * SQFT_PER_ACRE);
  const property = {
    address,
    cityState: str(right(es, /^City$/i, 2)),
    state: str(right(es, /^State$/i, 2)),
    acres,
    siteSf,
    buildingSf,
    coverage: buildingSf && siteSf ? buildingSf / siteSf : null,
  };
  if (!address) warnings.push("No property address on ES Summary.");

  // Sheets used below must describe the same property. The template carries
  // hidden tabs from earlier deals, so check rather than assume.
  if (address) {
    const key = norm(address).split(" ").slice(0, 2).join(" ");
    for (const [name, sheet] of [["Deal Overview", dov], ["Rent Roll", rr]] as const) {
      const title = str(sheet!.get("B2"));
      if (title && !norm(title).includes(key)) warnings.push(`The ${name} sheet is titled "${title}", not ${address}. It may be left over from another deal.`);
    }
  }

  // ---- Capitalization and yields ------------------------------------------
  const capHead = find(es, /^Capitalization$/i, { col: 2 });
  const capTotal = find(es, /^Total$/i, { col: 2, after: capHead?.row });
  const capitalization: ModelSummary["capitalization"] = [];
  if (capHead && capTotal && es) {
    for (let r = capHead.row + 1; r < capTotal.row; r++) {
      const label = str(es.at(r, 2));
      const amount = num(es.at(r, 3));
      if (!label || amount === null || amount === 0) continue;
      capitalization.push({ label, amount, psf: num(es.at(r, 4)) });
    }
  }
  const totalCost: Money = capTotal && es ? { amount: num(es.at(capTotal.row, 3)), psf: num(es.at(capTotal.row, 4)) } : { amount: null, psf: null };
  const yields = {
    goingIn: num(right(es, /^Going-?in/i, 1)),
    returnOnCostAtExit: num(right(es, /^Return on Cost/i, 1)),
    exitCap: num(right(es, /^Exit Cap$/i, 1)),
  };
  const price = capitalization.find((c) => /price/i.test(c.label))?.amount ?? null;

  // ---- Returns: Pro Forma's header block (LP / Unlevered / Levered) -------
  const head = find(pf, /^Levered LP Returns$/i);
  const block = (offset: number): Ret => {
    if (!head || !pf) return { irr: null, multiple: null };
    const irrRow = find(pf, /^IRR$/i, { col: 2, after: head.row - 1, before: head.row + 6 });
    const multRow = find(pf, /^Multiple$/i, { col: 2, after: head.row - 1, before: head.row + 8 });
    return { irr: irrRow ? num(pf.at(irrRow.row, head.col + offset)) : null, multiple: multRow ? num(pf.at(multRow.row, head.col + offset)) : null };
  };
  const months = num(right(pf, /^Month of Sale$/i, 2)) ?? num(right(dov, /^Hold Period$/i, 3));
  const returns = {
    holdYears: months ? Math.round((months / 12) * 10) / 10 : null,
    lp: block(0),
    unlevered: block(1),
    levered: block(2),
    profit: num(right(dov, /^Profit$/i, 3)),
  };
  if (!head) warnings.push("Couldn't find the Pro Forma returns block (Levered LP / Unlevered / Levered).");

  const dates = {
    acquisition: excelDate(right(dov, /^Acquisition Date$/i, 3)),
    sale: excelDate(right(dov, /^Sale Date$/i, 3)),
  };
  const debt = {
    loan: num(right(dov, /^Total Loan$/i, 2)),
    equity: num(right(dov, /^Total Equity$/i, 2)),
    ltpp: num(right(dov, /^LTPP$/i, 2)),
    ltc: num(right(dov, /^LTC$/i, 2)),
    index: num(right(dov, /^Index/i, 2)),
    spread: num(right(dov, /^Spread/i, 2)),
    interestOnlyMonths: num(right(dov, /^Interest Only$/i, 2)),
    amortizationMonths: num(right(dov, /^Amort/i, 2)),
  };

  // ---- Leasing assumptions (Deal Overview block) --------------------------
  const leasing: ModelSummary["leasing"] = [];
  const leasingHead = find(dov, /^Leasing Assumptions$/i, { col: 2 });
  const debtHead = find(dov, /^Debt Assumptions$/i, { col: 2 });
  if (leasingHead && dov) {
    for (let r = leasingHead.row + 1; r < (debtHead?.row ?? leasingHead.row + 20); r++) {
      const label = str(dov.at(r, 2));
      const v = dov.at(r, 4);
      if (!label || v === null) continue;
      let value: string;
      if (typeof v === "number") {
        if (/renewal|commission/i.test(label)) value = pct(v, 0);
        else if (/market rent/i.test(label)) value = `$${v.toFixed(2)} / SF / mo`;
        else if (/improvements/i.test(label)) value = `$${Math.round(v).toLocaleString("en-US")}`;
        else value = String(Math.round(v * 10) / 10);
      } else value = String(v).trim();
      leasing.push({ label, value });
    }
  }

  // ---- Rent roll ----------------------------------------------------------
  const rentRoll = readRentRoll(rr!, warnings);
  // Deal Overview's leasing block isn't always refreshed when the template is
  // reused; its MLA name has been seen carrying another deal's ("$3.85 FSG").
  const mlaIdx = leasing.findIndex((l) => /^MLA Name$/i.test(l.label));
  const rentRollMlas = new Set(rentRoll.rows.map((r) => r.mla).filter(Boolean));
  if (mlaIdx >= 0 && rentRollMlas.size && !rentRollMlas.has(leasing[mlaIdx].value)) {
    warnings.push(`Deal Overview's leasing block names the MLA "${leasing[mlaIdx].value}", but the rent roll uses ${[...rentRollMlas].map((x) => `"${x}"`).join(", ")}. The deck shows the rent roll's; update Deal Overview.`);
    leasing.splice(mlaIdx, 1);
  }

  // ---- Annual cash flow ---------------------------------------------------
  const cashFlow = readCashFlow(mpf!, returns.holdYears, warnings);

  // ---- Sensitivities ------------------------------------------------------
  const deal = readGrid(pf, /^SUPPORT TABLE - DEAL LEVEL RETURNS/i, "Deal-level returns (IRR / multiple)");
  const lp = readGrid(pf, /^SUPPORT TABLE - LP RETURNS/i, "LP returns (IRR / multiple)");
  const checkGrid = (grid: Grid | null, expected: Ret, name: string) => {
    const want = fmtRet(expected);
    if (!grid || !want || price === null || yields.exitCap === null) return;
    const col = grid.cols.findIndex((c) => Math.abs(c - yields.exitCap!) < 1e-6);
    if (col < 0) { warnings.push(`The ${name} sensitivity has no ${pct(yields.exitCap, 2)} exit-cap column, so it can't be checked against the base case.`); return; }
    const row = grid.rows.find((r) => Math.abs(r.key - price) < 1);
    if (!row) {
      // Price between two rows: the base IRR should fall between theirs.
      const irrOf = (cell: string) => { const m = cell.match(/^(-?\d+(?:\.\d+)?)%/); return m ? Number(m[1]) / 100 : null; };
      const below = [...grid.rows].reverse().find((r) => r.key < price), above = grid.rows.find((r) => r.key > price);
      const lo = above && irrOf(above.cells[col]), hi = below && irrOf(below.cells[col]);
      if (lo == null || hi == null) { warnings.push(`The ${name} sensitivity doesn't span the $${price.toLocaleString("en-US")} price, so it can't be checked against the base case.`); return; }
      if (expected.irr! < Math.min(lo, hi) - 0.001 || expected.irr! > Math.max(lo, hi) + 0.001) {
        warnings.push(`The ${name} sensitivity brackets $${price.toLocaleString("en-US")} between ${above!.cells[col]} and ${below!.cells[col]}, but the base case is ${want}. Recalculate the data tables in Excel (F9) and save before building the deck.`);
      }
      return;
    }
    if (row.cells[col] !== want) {
      warnings.push(`The ${name} sensitivity shows ${row.cells[col]} at the base price and exit cap, but the model's base case is ${want}. Recalculate the data tables in Excel (F9) and save before building the deck.`);
    }
  };
  checkGrid(deal, returns.levered, "deal-level");
  checkGrid(lp, returns.lp, "LP");
  // The fixed "Base Case" exit-cap block is the one Golden Spike's deck used.
  const baseBlock = find(pf, /^Deal Level Returns$/i, { col: 2 });
  if (baseBlock && pf && yields.exitCap !== null) {
    const capRow = find(pf, /^Exit Cap$/i, { col: 2, after: baseBlock.row, before: baseBlock.row + 4 });
    const irrRow = find(pf, /^IRR \/ Equity Multiple$/i, { col: 2, after: baseBlock.row, before: baseBlock.row + 5 });
    if (capRow && irrRow) {
      for (let c = 3; c < 10; c++) {
        const cap = num(pf.at(capRow.row, c));
        if (cap !== null && Math.abs(cap - yields.exitCap) < 1e-6) {
          const shown = str(pf.at(irrRow.row, c));
          const want = fmtRet(returns.levered);
          if (shown && want && shown !== want) warnings.push(`Pro Forma's "Base Case" exit-cap table (${numberToCol(c)}${irrRow.row}) shows ${shown}, but the base case is ${want}. It is not at the current price; the deck uses the price × exit cap tables instead.`);
          break;
        }
      }
    }
  }

  // ---- Light reconciliation ------------------------------------------------
  const noi1 = cashFlow.rows.find((r) => r.label === "NOI")?.values[1] ?? null;
  if (noi1 && price && yields.goingIn && Math.abs(noi1 / price - yields.goingIn) > 0.002) {
    warnings.push(`Year 1 NOI / price is ${pct(noi1 / price, 2)}, but the going-in cap rate shows ${pct(yields.goingIn, 2)}.`);
  }
  if (returns.levered.irr === null) warnings.push("No levered IRR found.");

  return {
    version: MODEL_VERSION,
    source: { fileName, modelDate: excelDate(dov!.get("B3")) },
    property, capitalization, totalCost, yields, returns, dates, debt, leasing, rentRoll, cashFlow,
    sensitivities: { deal, lp },
    warnings,
  };
}

function readRentRoll(rr: Sheet, warnings: string[]): ModelSummary["rentRoll"] {
  const header = find(rr, /^Tenant$/i, { col: 2 });
  if (!header) { warnings.push("Couldn't find the rent roll header on the Rent Roll sheet."); return { rows: [], totalSf: null, waltYears: null }; }
  const cols = new Map<string, number>();
  for (let c = 2; c < 60; c++) { const v = str(rr.at(header.row, c)); if (v && !cols.has(norm(v))) cols.set(norm(v), c); }
  const col = (name: string) => cols.get(norm(name)) ?? null;
  // Dollar columns sit under group headings one or two rows up.
  const group = (re: RegExp) => {
    for (let r = header.row - 1; r >= header.row - 3; r--) for (let c = 2; c < 60; c++) {
      const v = str(rr.at(r, c)); if (v && re.test(v)) return c;
    }
    return null;
  };
  const sbr = group(/^Scheduled Base Rent at Closing$/i), market = group(/^Market Rent at Closing$/i), newLease = group(/^SBR at New Lease Start$/i);
  const at = (r: number, c: number | null) => (c === null ? null : rr.at(r, c));
  const rows: RentRollRow[] = [];
  let totalRow: number | null = null;
  for (let r = header.row + 1; r < header.row + 80; r++) {
    const label = str(rr.at(r, 2));
    if (!label) continue;
    if (/^Total$/i.test(label)) { totalRow = r; break; }
    if (/^(Tenancy|Subtotal|Leave Blank|Vacant)/i.test(label)) continue;
    const sf = num(at(r, col("SF")));
    if (sf === null) continue;
    rows.push({
      tenant: label.replace(/^\d+\.\s*/, ""),
      suite: str(at(r, col("Suite / Bldg."))),
      sf,
      pctSf: num(at(r, col("% of SF"))),
      start: excelDate(at(r, col("Lease Start"))),
      expiration: excelDate(at(r, col("Lease Expiration"))) ?? excelDate(at(r, col("Convert to Date"))),
      remainingMonths: num(at(r, col("Remaining Term (mo.)"))),
      mla: str(at(r, col("MLA Name"))),
      renewalPct: num(at(r, col("Renewal %"))),
      downtimeMonths: num(at(r, col("Downtime"))),
      sbrAnnual: num(at(r, sbr)), sbrPsfMonthly: sbr === null ? null : num(at(r, sbr + 1)),
      marketAnnual: num(at(r, market)), marketPsfMonthly: market === null ? null : num(at(r, market + 1)),
      newLeaseAnnual: num(at(r, newLease)),
    });
  }
  if (!rows.length) warnings.push("The rent roll has no tenant rows.");
  return {
    rows,
    totalSf: totalRow ? num(at(totalRow, col("SF"))) : null,
    waltYears: totalRow ? num(at(totalRow, col("Remaining Term (mo.)"))) : null,
  };
}

// Rows shown on the Cash Flow slide, in order. Section-scoped where a label
// repeats ("Leasing Costs" appears under both leasing/capex and the sale).
const CF_ROWS: Array<{ label: string; section?: RegExp; emphasis?: boolean; format?: "pct"; show?: string }> = [
  { label: "Potential Base Rent" },
  { label: "Absorption & Turnover Vacancy" },
  { label: "Free Rent" },
  { label: "Scheduled Base Rent", emphasis: true },
  { label: "Total Expense Recoveries" },
  { label: "Total Vacancy & Credit Loss" },
  { label: "Other Revenue and Adjustments" },
  { label: "TOTAL INCOME", emphasis: true, show: "Total Income" },
  { label: "TOTAL OPERATING EXPENSES", emphasis: true, show: "Total Operating Expenses" },
  { label: "NOI", emphasis: true },
  { label: "Cap Rate (Year 1 vs. PP, others vs. TC)", format: "pct", show: "Cap Rate (Yr 1 vs. PP, others vs. TC)" },
  { label: "NOI Growth YOY", format: "pct", show: "NOI Growth YoY" },
  { label: "Debt Service" },
  { label: "Capex Reserves" },
  { label: "NET CASH FLOW FROM OPERATIONS", emphasis: true, show: "Net Cash Flow from Operations" },
  { label: "Capex Costs", section: /^LEASING AND CAPEX$/ },
  { label: "Leasing Costs", section: /^LEASING AND CAPEX$/ },
  { label: "Sale Price", section: /^ASSET SALE/ },
  { label: "Sale Costs", section: /^ASSET SALE/ },
  { label: "Debt Payoff", section: /^ASSET SALE/ },
  { label: "Sale Proceeds", section: /^ASSET SALE/, emphasis: true, show: "Net Sale Proceeds" },
  { label: "LEVERED CASH FLOW", emphasis: true, show: "Levered Cash Flow" },
  { label: "Levered Cash-on-Cash", format: "pct" },
];

function readCashFlow(mpf: Sheet, holdYears: number | null, warnings: string[]): ModelSummary["cashFlow"] {
  const yearRow = find(mpf, /^Year$/i, { col: 2 });
  if (!yearRow) { warnings.push("Couldn't find the Year header on Memo Pro Forma."); return { years: [], rows: [] }; }
  const hold = Math.ceil(holdYears ?? 10);
  const yearCols: Array<{ col: number; label: string }> = [{ col: 4, label: "Year 0" }];
  for (let c = 5; c < 30; c++) {
    const y = num(mpf.at(yearRow.row, c));
    if (y === null || y > hold) continue;
    yearCols.push({ col: c, label: `Year ${y}` });
  }
  const rows: CashFlowRow[] = [];
  for (const spec of CF_ROWS) {
    const section = spec.section ? find(mpf, spec.section, { col: 2 }) : null;
    if (spec.section && !section) continue;
    const exact = new RegExp(`^${spec.label.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}\\s*$`, "i");
    // A label can also be a section heading ("LEVERED CASH FLOW" heads the
    // block that ends in the row of the same name): take the first with figures.
    let values: Array<number | null> | null = null;
    for (let after = section?.row ?? 0, hit = find(mpf, exact, { col: 2, after }); hit; after = hit.row, hit = find(mpf, exact, { col: 2, after })) {
      const v = yearCols.map((y) => num(mpf.at(hit!.row, y.col)));
      if (v.some((x) => x !== null)) { values = v; break; }
    }
    if (!values) continue;
    const zero = spec.format === "pct" ? 1e-6 : 0.5;
    if (values.every((v) => v === null || Math.abs(v) < zero)) continue; // all-zero rows are noise on a slide
    rows.push({ label: spec.show ?? spec.label, values, emphasis: spec.emphasis, format: spec.format });
  }
  // Year 0 (closing) only matters when some row carries a closing value.
  const closingUsed = rows.some((r) => r.values[0] !== null && Math.abs(r.values[0]!) >= 0.5);
  if (!closingUsed) { yearCols.shift(); for (const r of rows) r.values.shift(); }
  return { years: yearCols.map((y) => y.label), rows };
}

function readGrid(pf: Sheet | null, title: RegExp, name: string): Grid | null {
  const t = find(pf, title, { col: 2 });
  if (!t || !pf) return null;
  // Header row: first row below the title whose columns C.. are exit caps.
  for (let r = t.row + 1; r < t.row + 4; r++) {
    const cols: number[] = [];
    for (let c = 3; c < 12; c++) { const v = num(pf.at(r, c)); if (v !== null && v > 0 && v < 0.2) cols.push(v); else if (cols.length) break; }
    if (!cols.length) continue;
    const rows: Grid["rows"] = [];
    for (let rr = r + 1; rr < r + 20; rr++) {
      const key = num(pf.at(rr, 2));
      if (key === null) break;
      rows.push({ key, cells: cols.map((_, i) => str(pf.at(rr, 3 + i)) ?? "—") });
    }
    return rows.length ? { title: name, rowLabel: "Purchase price", colLabel: "Exit cap", cols, rows } : null;
  }
  return null;
}

// ---- Server-side guard ------------------------------------------------------
// The summary is built in the browser, so the server treats it as untrusted:
// bounded sizes and the expected shape. Everything is rendered as escaped text.
export function validateModelSummary(value: unknown): ModelSummary {
  const fail = (why: string): never => { throw new Error(`The model summary is invalid (${why}). Re-select the workbook.`); };
  if (!value || typeof value !== "object") fail("not an object");
  const json = JSON.stringify(value);
  if (json.length > 250_000) fail("too large");
  const m = value as ModelSummary;
  if (m.version !== MODEL_VERSION) fail("unknown version");
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8) fail("too deeply nested");
    if (typeof v === "string") { if (v.length > 600) fail("text too long"); return; }
    if (typeof v === "number") { if (!Number.isFinite(v)) fail("non-finite number"); return; }
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (Array.isArray(v)) { if (v.length > 200) fail("list too long"); v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === "object") { for (const x of Object.values(v as object)) walk(x, depth + 1); return; }
    fail("unexpected value");
  };
  walk(m, 0);
  for (const key of ["source", "property", "totalCost", "yields", "returns", "dates", "debt", "rentRoll", "cashFlow", "sensitivities"] as const) {
    if (!m[key] || typeof m[key] !== "object") fail(`missing ${key}`);
  }
  for (const key of ["capitalization", "leasing", "warnings"] as const) if (!Array.isArray(m[key])) fail(`missing ${key}`);
  if (!Array.isArray(m.rentRoll.rows) || !Array.isArray(m.cashFlow.rows) || !Array.isArray(m.cashFlow.years)) fail("bad tables");
  return m;
}
