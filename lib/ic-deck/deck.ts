// lib/ic-deck/deck.ts
//
// The IC executive summary, in the Golden Spike v2 order (23 slides). Every
// figure comes from one of three places, and each slide's notes say which:
//   - the acquisition model (ModelSummary, read from the workbook's cached values)
//   - Hopper records (deal, LOI terms, comps, owned assets)
//   - Google Static Maps imagery of the recorded pin
// What none of those can supply -- tenant credit, market canvas research,
// photos, zoning determinations -- is left as a clearly marked open item rather
// than written for the analyst.

import PizZip from "pizzip";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelSummary } from "./model";
import { MUTED, NAVY, R_NS, REL_NS, SlideBuilder, type Picture, type Para } from "./pptx-kit";

export interface DeckComp {
  n: number;
  address: string;
  city: string | null;
  date: string | null;
  dateEstimated?: boolean;
  buildingSf: number | null;
  acres: number | null;
  /** Quoted as recorded, with its unit, e.g. "$5,200 / acre / mo". */
  quoted: string;
  /** Normalised: lease $/SF bldg/mo, sale $/SF bldg. */
  normalized: string;
  party: string | null;
  distanceMi: number | null;
  capRate?: number | null;
  lat?: number;
  lng?: number;
}
export interface DeckAsset { address: string; city: string | null; acres: number | null; buildingSf: number | null; status: string; occupancy: string | null; distanceMi: number | null }

export interface IcDeckInput {
  model: ModelSummary;
  deal: {
    id: string;
    address: string;
    city: string | null;
    state: string | null;
    market: string | null;
    submarket: string | null;
    stage: string;
    stageLabel: string;
    acquisitionType: string | null;
    contractPrice: number | null;
    lastOffer: { price: number; date: string } | null;
    ddEndOn: string | null;
    closingOn: string | null;
    loi: Record<string, string>;
  };
  leaseComps: DeckComp[];
  saleComps: DeckComp[];
  compRadiusMiles: number;
  assets: DeckAsset[];
  maps: Partial<Record<"coverPhoto" | "coverAerial" | "location" | "aerial" | "aerialClose" | "leaseComps" | "saleComps" | "portfolio", Picture>>;
  preparedOn: Date;
}

// ---- formatting -------------------------------------------------------------
const usd = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${v < 0 ? "(" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}${v < 0 ? ")" : ""}`);
const n0 = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "(" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")}${v < 0 ? ")" : ""}`);
const sf = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString("en-US")} SF`);
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const ac = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)} AC`);
const mult = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}x`);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const date = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${m}/${d}/${y}`;
};
const monthYear = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const millions = (v: number) => `$${(v / 1e6).toFixed(2)}M`;

const OPEN = (what: string): Para => ({ runs: [{ text: `[Analyst: ${what}]`, color: "B4541A", italic: true }] });

export function renderIcDeck(input: IcDeckInput): Buffer {
  const { model: m, deal } = input;
  const zip = new PizZip(readFileSync(join(process.cwd(), "lib/ic-deck/templates/ic-deck.pptx")));
  const property = m.property.address ?? deal.address;
  const cityState = m.property.cityState ?? [deal.city, deal.state].filter(Boolean).join(", ");
  const tenants = m.rentRoll.rows.map((r) => r.tenant);
  const occupied = m.rentRoll.totalSf && m.property.buildingSf ? m.rentRoll.rows.reduce((s, r) => s + (r.sf ?? 0), 0) / m.property.buildingSf : null;
  const price = m.capitalization.find((c) => /price/i.test(c.label))?.amount ?? null;
  const hold = m.returns.holdYears;
  const holdTag = `${hold ?? "?"}-Yr Hold; ${pct(m.yields.exitCap, 1)} exit`;
  const source = `Model: ${m.source.fileName}${m.source.modelDate ? ` (as of ${date(m.source.modelDate)})` : ""}`;
  const footer = `DRAFT for IC review · Built by Hopper ${date(input.preparedOn.toISOString())} · ${source}`;
  const slides: SlideBuilder[] = [];
  const slide = (title?: string) => {
    const s = new SlideBuilder(slides.length + 1);
    if (title) { s.title(title); s.pageNumber(); s.footer(footer); }
    slides.push(s);
    return s;
  };
  const mapOrPlaceholder = (s: SlideBuilder, key: keyof IcDeckInput["maps"], what: string, box: { x: number; y: number; w: number; h: number }) => {
    const pic = input.maps[key];
    if (pic) s.picture(pic, box); else s.placeholder(what, box);
  };

  // 1. Cover --------------------------------------------------------------
  {
    // Same geometry as the Golden Spike cover: a navy rule, two images side by
    // side down to the layout's band, then the title block and strategy tags.
    const s = slide();
    s.rect({ x: 0, y: 1.38, w: 10, h: 0.19 }, NAVY);
    mapOrPlaceholder(s, "coverPhoto", "Cover photo of the property (drone or street view).", { x: 0, y: 1.57, w: 5.25, h: 3.77 });
    mapOrPlaceholder(s, "coverAerial", "Cover aerial with the parcel outlined.", { x: 5.25, y: 1.57, w: 4.75, h: 3.77 });
    const walt = m.rentRoll.waltYears;
    const strategy = occupied !== null && occupied >= 0.999 ? "Stabilized Opportunity" : occupied ? "Value-Add Opportunity" : "Opportunity";
    const lease = deal.acquisitionType && /leaseback|slb/i.test(deal.acquisitionType) ? `${walt ? Math.round(walt) + "-Year " : ""}Sale-Leaseback` : walt ? `${walt.toFixed(1)}-Year WALT` : null;
    s.text([{ runs: [{ text: `${property}${m.property.acres ? ` (${m.property.acres.toFixed(2)} AC)` : ""}` }], spaceAfter: 0 }, { runs: [{ text: cityState, size: 24 }] }],
      { x: 0.21, y: 5.5, w: 6.5, h: 1.05 }, { size: 28, bold: true, color: NAVY });
    s.text(monthYear(input.preparedOn), { x: 0.21, y: 6.5, w: 4, h: 0.35 }, { size: 15, bold: true, color: "7F7F7F" });
    s.rect({ x: 6.79, y: 5.61, w: 2.67, h: 0.88 }, "FFFFFF", NAVY);
    s.text([{ runs: [{ text: strategy, italic: true }], align: "ctr" }], { x: 6.79, y: 5.61, w: 2.67, h: 0.88 }, { size: 18, bold: true, color: "000000", anchor: "ctr" });
    if (lease) {
      s.rect({ x: 6.79, y: 6.58, w: 2.67, h: 0.8 }, "FFFFFF", NAVY);
      s.text([{ runs: [{ text: lease, italic: true }], align: "ctr" }], { x: 6.79, y: 6.58, w: 2.67, h: 0.8 }, { size: 17, bold: true, color: "00B050", anchor: "ctr" });
    }
    s.notes.push("Draft for IC review. " + source, "Cover images are Google satellite imagery of the recorded pin; replace with drone/site photos.");
  }

  // 2. Executive Summary --------------------------------------------------
  {
    const s = slide("Executive Summary");
    const tiles: Array<[string, string]> = [
      [pct(m.returns.levered.irr), `GLIRR (${holdTag})`],
      [pct(m.returns.unlevered.irr), `GUIRR (${holdTag})`],
      [mult(m.returns.levered.multiple), `Equity Multiple (${holdTag})`],
      [pct(m.yields.goingIn, 2), `Going-in Cap Rate (${pct(m.yields.returnOnCostAtExit, 2)} YTC at exit)`],
      [pct(m.returns.lp.irr), `Levered LP IRR (${holdTag})`],
    ];
    tiles.forEach(([big, small], i) => {
      const x = 0.2 + i * 1.93;
      s.rect({ x, y: 1.36, w: 1.83, h: 0.72 }, "EEF2F7");
      s.text([{ runs: [{ text: big, bold: true, size: 15, color: NAVY }], align: "ctr", spaceAfter: 0 }, { runs: [{ text: small, size: 7, color: MUTED }], align: "ctr" }], { x, y: 1.36, w: 1.83, h: 0.72 }, { anchor: "ctr" });
    });
    const fees = m.totalCost.amount !== null && price !== null ? m.totalCost.amount - price : null;
    const status = deal.contractPrice ? `Under contract at ${usd(deal.contractPrice)}` : deal.lastOffer ? `Offer of ${usd(deal.lastOffer.price)} submitted ${date(deal.lastOffer.date)}` : `Stage: ${deal.stageLabel}`;
    const terms = [deal.loi.depositAmount && `deposit of ${/^\$/.test(deal.loi.depositAmount) ? deal.loi.depositAmount : "$" + deal.loi.depositAmount}`, deal.loi.ddDays && `${deal.loi.ddDays} days due diligence`, deal.loi.closingDays && `${deal.loi.closingDays} days to close`].filter(Boolean).join("; ");
    const head = (t: string): Para => ({ runs: [{ text: t, bold: true, color: NAVY, size: 10 }], spaceAfter: 1 });
    const body = (t: string): Para => ({ runs: [{ text: t, size: 9 }], bullet: true, spaceAfter: 2 });
    const tenantLine = tenants.length ? `leased to ${tenants.join(", ").replace(/\.$/, "")}` : "currently vacant";
    s.text([
      head("Site Overview"),
      body(`${pct(occupied, 0)} leased IOS site in ${cityState} on ${m.property.acres?.toFixed(2) ?? "—"} acres with a ${sf(m.property.buildingSf)} building (${pct(m.property.coverage, 1)} coverage), ${tenantLine}.`),
      body(`Going-in basis of ${usd(m.capitalization[0]?.psf, 2)} PSF (${usd(price)} purchase price); all-in cost of ${usd(m.totalCost.psf, 2)} PSF (${usd(m.totalCost.amount)}).`),
      head("Location Highlights"),
      OPEN("highway access, submarket, nearby demand drivers"),
      head("Deal Status"),
      body(status + (terms ? `; ${terms}.` : ".")),
      head("Zoning"),
      OPEN("governing jurisdiction, district and outdoor-storage rights (see Site research agent)"),
      head("Underwriting Assumptions"),
      body(`${hold ?? "—"}-year hold; ${pct(m.yields.exitCap, 2)} exit cap on a ${pct(m.yields.returnOnCostAtExit, 2)} yield-to-cost; ${usd(fees)} of acquisition, financing and other costs capitalized into the ${usd(m.totalCost.psf, 2)} PSF all-in basis.`),
      body(`Debt: ${pct(m.debt.ltc, 1)} LTC (${usd(m.debt.loan)}), ${pct(m.debt.index, 2)} index + ${pct(m.debt.spread, 2)} spread, ${m.debt.interestOnlyMonths ?? "—"} months interest-only.`),
    ], { x: 0.2, y: 2.2, w: 5.45, h: 4.72 }, { size: 9 });
    const right = 5.8, w = 3.98;
    s.table(["Site", ""], [
      ["Address", property], ["City, State", cityState], ["Tenant", tenants.join(", ") || "Vacant"],
      ["Site AC", m.property.acres?.toFixed(2) ?? "—"], ["Site SF", n0(m.property.siteSf)], ["Building SF", n0(m.property.buildingSf)], ["Coverage %", pct(m.property.coverage, 1)],
    ], { x: right, y: 2.2, w, h: 1.9 }, { size: 8, widths: [1.1, 1.9], align: ["l", "r"], rowHeight: 0.22 });
    s.table(["Capitalization", "$ Amount", "$ PSF"], [
      ...m.capitalization.map((c) => [c.label, usd(c.amount), usd(c.psf, 2)]),
      ["Total", usd(m.totalCost.amount), usd(m.totalCost.psf, 2)],
    ], { x: right, y: 4.15, w, h: 1.5 }, { size: 8, widths: [1.7, 1, 0.8], align: ["l", "r", "r"], emphasis: [m.capitalization.length], rowHeight: 0.2 });
    s.table(["Yields", "% Cap Rate"], [
      ["Going-in", pct(m.yields.goingIn, 2)], ["Return on Cost at Exit", pct(m.yields.returnOnCostAtExit, 2)], ["Exit Cap", pct(m.yields.exitCap, 2)],
    ], { x: right, y: 5.65 + 0.2 * Math.max(0, m.capitalization.length - 4), w, h: 0.8 }, { size: 8, widths: [2.2, 1], align: ["l", "r"], rowHeight: 0.2 });
    s.notes.push(source + ": ES Summary, Pro Forma returns block, Deal Overview debt terms.", `Hopper deal record: stage ${deal.stageLabel}; LOI terms as last saved.`);
    if (m.warnings.length) s.notes.push("MODEL CHECKS — resolve before circulating:", ...m.warnings.map((x) => "• " + x));
  }

  // 3-5. Location and aerials --------------------------------------------
  {
    const s = slide("Location Overview");
    mapOrPlaceholder(s, "location", "Location map of the subject in its metro.", { x: 0.3, y: 1.42, w: 9.4, h: 5.45 });
    const s4 = slide("Aerial Overview");
    mapOrPlaceholder(s4, "aerial", "Aerial of the subject with highway access annotated.", { x: 0.3, y: 1.42, w: 9.4, h: 5.0 });
    s4.text([OPEN("annotate nearest highway / interchange and drive time")], { x: 0.3, y: 6.47, w: 9.4, h: 0.45 }, { size: 9 });
    const s5 = slide("Aerial Snapshot");
    mapOrPlaceholder(s5, "aerialClose", "Close aerial of the site with the yard outlined.", { x: 0.3, y: 1.42, w: 9.4, h: 5.0 });
    s5.text([OPEN("outline the parcel and usable outdoor-storage acreage")], { x: 0.3, y: 6.47, w: 9.4, h: 0.45 }, { size: 9 });
  }

  // 6. Property snapshots ------------------------------------------------
  {
    const s = slide("Property Snapshots");
    [[0.3, 1.45], [5.05, 1.45], [0.3, 4.2], [5.05, 4.2]].forEach(([x, y], i) =>
      s.placeholder(i === 0 ? "Site photos (building, yard, loading, cranes/power)." : "Site photo.", { x, y, w: 4.65, h: 2.6 }));
  }

  // 7. Tenant overview ---------------------------------------------------
  {
    const s = slide("Tenant Overview");
    s.text([
      OPEN(`${tenants.join(", ") || "tenant"}: business, history, ownership, end markets and use of the site`),
      OPEN("credit: financials reviewed, guaranty, security deposit — do not assert creditworthiness without them"),
    ], { x: 0.3, y: 1.45, w: 9.4, h: 1.5 }, { size: 11 });
    s.table(["Tenant", "SF", "Lease Start", "Expiration", "Remaining (mo.)", "Rent / Yr.", "$ / SF / Yr.", "$ / SF / Mo."],
      m.rentRoll.rows.map((r) => [r.tenant, n0(r.sf), date(r.start), date(r.expiration), n0(r.remainingMonths), usd(r.sbrAnnual), r.sbrAnnual && r.sf ? usd(r.sbrAnnual / r.sf, 2) : "—", r.sbrPsfMonthly == null ? "—" : usd(r.sbrPsfMonthly, 2)]),
      { x: 0.3, y: 3.1, w: 9.4, h: 1.2 }, { size: 9, widths: [2.2, 0.9, 1, 1, 1, 1.1, 1, 1], align: ["l", "r", "r", "r", "r", "r", "r", "r"] });
    s.notes.push(source + ": Rent Roll.");
  }

  // 8. Model — base case -------------------------------------------------
  {
    const s = slide("Model – Base Case");
    const leftBottom = s.table(["Sources & Uses", "$ Amount", "$ PSF"], [
      ...m.capitalization.map((c) => [c.label, usd(c.amount), usd(c.psf, 2)]),
      ["Total Uses", usd(m.totalCost.amount), usd(m.totalCost.psf, 2)],
      ["Loan", usd(m.debt.loan), m.debt.loan && m.property.buildingSf ? usd(m.debt.loan / m.property.buildingSf, 2) : "—"],
      ["Equity", usd(m.debt.equity), m.debt.equity && m.property.buildingSf ? usd(m.debt.equity / m.property.buildingSf, 2) : "—"],
    ], { x: 0.3, y: 1.45, w: 4.55, h: 2.6 }, { size: 9, widths: [2, 1.2, 0.9], align: ["l", "r", "r"], emphasis: [m.capitalization.length], rowHeight: 0.26 });
    const returnsBottom = s.table(["Returns", "IRR", "Multiple"], [
      ["Deal level, levered (GLIRR)", pct(m.returns.levered.irr), mult(m.returns.levered.multiple)],
      ["Deal level, unlevered (GUIRR)", pct(m.returns.unlevered.irr), mult(m.returns.unlevered.multiple)],
      ["LP, levered", pct(m.returns.lp.irr), mult(m.returns.lp.multiple)],
    ], { x: 5.15, y: 1.45, w: 4.55, h: 1.1 }, { size: 9, widths: [2.4, 0.9, 0.9], align: ["l", "r", "r"], rowHeight: 0.26 });
    s.table(["Key Assumptions", "Base Case"], [
      ["Acquisition date", date(m.dates.acquisition)], ["Sale date", date(m.dates.sale)], ["Hold", `${hold ?? "—"} years`],
      ["Going-in cap", pct(m.yields.goingIn, 2)], ["Return on cost at exit", pct(m.yields.returnOnCostAtExit, 2)], ["Exit cap", pct(m.yields.exitCap, 2)],
      ["Profit", usd(m.returns.profit)],
    ], { x: 5.15, y: returnsBottom + 0.25, w: 4.55, h: 2.1 }, { size: 9, widths: [2.4, 1.8], align: ["l", "r"], rowHeight: 0.26 });
    s.table(["Debt", "Terms"], [
      ["Loan to purchase price", pct(m.debt.ltpp, 1)], ["Loan to cost", pct(m.debt.ltc, 1)],
      ["Rate", `${pct(m.debt.index, 2)} index + ${pct(m.debt.spread, 2)}`],
      ["Interest-only / amortization", `${m.debt.interestOnlyMonths ?? "—"} / ${m.debt.amortizationMonths ?? "—"} months`],
    ], { x: 0.3, y: leftBottom + 0.25, w: 4.55, h: 1.3 }, { size: 9, widths: [2, 2.1], align: ["l", "r"], rowHeight: 0.26 });
    s.notes.push(source + ": ES Summary, Pro Forma returns block, Deal Overview.");
  }

  // 9. Market leasing assumptions ---------------------------------------
  {
    const s = slide("Market Leasing Assumptions – Base Case");
    s.table(["Tenant", "Suite", "SF", "% of SF", "Start", "Expiration", "Rem. (mo.)", "MLA", "Renewal", "Downtime"],
      [...m.rentRoll.rows.map((r) => [r.tenant, r.suite ?? "—", n0(r.sf), pct(r.pctSf, 1), date(r.start), date(r.expiration), n0(r.remainingMonths), r.mla ?? "—", pct(r.renewalPct, 0), r.downtimeMonths == null ? "—" : `${r.downtimeMonths} mo.`]),
        ["Total", "", n0(m.rentRoll.totalSf), "", "", "", m.rentRoll.waltYears == null ? "" : `${m.rentRoll.waltYears.toFixed(2)} yr WALT`, "", "", ""]],
      { x: 0.3, y: 1.45, w: 9.4, h: 1.0 }, { size: 8, widths: [1.9, 0.6, 0.8, 0.7, 0.85, 0.85, 1.05, 1.5, 0.7, 0.75], align: ["l", "l", "r", "r", "r", "r", "r", "l", "r", "r"], emphasis: [m.rentRoll.rows.length], rowHeight: 0.24 });
    const y2 = 1.45 + 0.24 * (m.rentRoll.rows.length + 2) + 0.25;
    s.table(["Tenant", "SBR at Closing / Yr.", "$ / SF / Yr.", "Market Rent / Yr.", "$ / SF / Yr.", "SBR at New Lease / Yr.", "$ / SF / Yr."],
      m.rentRoll.rows.map((r) => [r.tenant, usd(r.sbrAnnual), r.sbrAnnual && r.sf ? usd(r.sbrAnnual / r.sf, 2) : "—", usd(r.marketAnnual), r.marketAnnual && r.sf ? usd(r.marketAnnual / r.sf, 2) : "—", usd(r.newLeaseAnnual), r.newLeaseAnnual && r.sf ? usd(r.newLeaseAnnual / r.sf, 2) : "—"]),
      { x: 0.3, y: y2, w: 9.4, h: 0.8 }, { size: 8, widths: [1.9, 1.2, 0.9, 1.2, 0.9, 1.3, 0.9], align: ["l", "r", "r", "r", "r", "r", "r"], rowHeight: 0.24 });
    const half = Math.ceil(m.leasing.length / 2);
    const y3 = y2 + 0.24 * (m.rentRoll.rows.length + 1) + 0.3;
    s.table(["Leasing Assumption", "Base Case"], m.leasing.slice(0, half).map((l) => [l.label, l.value]), { x: 0.3, y: y3, w: 4.55, h: 1.6 }, { size: 8, widths: [2.4, 1.6], align: ["l", "r"], rowHeight: 0.22 });
    if (m.leasing.length > half) s.table(["Leasing Assumption", "Base Case"], m.leasing.slice(half).map((l) => [l.label, l.value]), { x: 5.15, y: y3, w: 4.55, h: 1.6 }, { size: 8, widths: [2.4, 1.6], align: ["l", "r"], rowHeight: 0.22 });
    s.notes.push(source + ": Rent Roll and Deal Overview leasing assumptions. Rent PSF is per building SF; the model's MLA is quoted per month.");
  }

  // 10. Cash flow --------------------------------------------------------
  {
    const s = slide("Cash Flow – Base Case");
    const rows = m.cashFlow.rows.map((r) => [r.label, ...r.values.map((v) => (v === null ? "—" : r.format === "pct" ? pct(v, 1) : n0(v)))]);
    const rh = Math.min(0.235, 5.3 / (rows.length + 1));
    s.table(["Annual Cash Flow ($)", ...m.cashFlow.years], rows, { x: 0.3, y: 1.42, w: 9.4, h: 5.3 },
      { size: rows.length > 18 ? 7.5 : 8, widths: [2.6, ...m.cashFlow.years.map(() => 1)], align: ["l", ...m.cashFlow.years.map(() => "r" as const)], emphasis: m.cashFlow.rows.flatMap((r, i) => (r.emphasis ? [i] : [])), rowHeight: rh });
    s.notes.push(source + ": Memo Pro Forma (annual). Figures as last calculated in Excel.");
  }

  // 11. Sensitivities ----------------------------------------------------
  {
    const s = slide("Sensitivity Analysis – Base Case");
    const grids = [m.sensitivities.deal, m.sensitivities.lp];
    grids.forEach((g, gi) => {
      const x = gi === 0 ? 0.3 : 5.15;
      s.text([{ runs: [{ text: gi === 0 ? `Deal Returns (${hold ?? "?"}-Yr Hold)` : `LP Returns (${hold ?? "?"}-Yr Hold)`, bold: true, color: NAVY }] }], { x, y: 1.42, w: 4.55, h: 0.3 }, { size: 11 });
      if (!g) { s.placeholder("Price × exit cap sensitivity from the model.", { x, y: 1.8, w: 4.55, h: 3 }); return; }
      // Shade only an exact base-price row; between rows, the note says so.
      const hlRow = price === null ? -1 : g.rows.findIndex((r) => Math.abs(r.key - price) < 1);
      const hlCol = g.cols.findIndex((c) => m.yields.exitCap !== null && Math.abs(c - m.yields.exitCap) < 1e-6);
      s.table(["Price / Exit Cap", ...g.cols.map((c) => pct(c, 2))],
        g.rows.map((r) => [`${millions(r.key)}${m.property.buildingSf ? ` ($${Math.round(r.key / m.property.buildingSf)} PSF)` : ""}`, ...r.cells]),
        { x, y: 1.8, w: 4.55, h: 3.5 }, { size: 8, widths: [1.6, ...g.cols.map(() => 1)], align: ["l", ...g.cols.map(() => "ctr" as const)], highlight: hlRow >= 0 && hlCol >= 0 ? [[hlRow, hlCol + 1]] : [], rowHeight: 0.27 });
    });
    const g0 = m.sensitivities.deal;
    const exactRow = price !== null && g0?.rows.some((r) => Math.abs(r.key - price) < 1);
    const below = price !== null ? [...(g0?.rows ?? [])].reverse().find((r) => r.key < price) : undefined;
    const above = price !== null ? g0?.rows.find((r) => r.key > price) : undefined;
    const where = exactRow ? `Shaded: the ${usd(price)} base price at the ${pct(m.yields.exitCap, 2)} base exit cap.`
      : below && above ? `The ${usd(price)} base price falls between the ${millions(below.key)} and ${millions(above.key)} rows; base case is ${pct(m.returns.levered.irr)} / ${mult(m.returns.levered.multiple)} (deal), ${pct(m.returns.lp.irr)} / ${mult(m.returns.lp.multiple)} (LP).`
      : `Base case: ${pct(m.returns.levered.irr)} / ${mult(m.returns.levered.multiple)} (deal), ${pct(m.returns.lp.irr)} / ${mult(m.returns.lp.multiple)} (LP).`;
    s.text([{ runs: [{ text: `${where} Cells read IRR / equity multiple.`, color: MUTED }] }], { x: 0.3, y: 6.5, w: 9.4, h: 0.4 }, { size: 8 });
    s.notes.push(source + ": Pro Forma support tables (deal level and LP), cached values from Excel's data tables.");
    const stale = m.warnings.filter((w) => /sensitivity|data tables|exit-cap table/i.test(w));
    if (stale.length) s.notes.push(...stale.map((w) => "MODEL CHECK: " + w));
  }

  // 12-15. Market canvas -------------------------------------------------
  {
    const where = deal.submarket || deal.market || cityState;
    for (const sub of ["", " – Occupancy Breakdown", " – Tenancy Breakdown", " – Ownership Breakdown"]) {
      const s = slide(`${where} IOS Market Canvas${sub}`);
      s.placeholder(`${where} IOS market canvas${sub.replace(" – ", ": ").toLowerCase()} exhibit, with survey source and date.`, { x: 0.3, y: 1.45, w: 9.4, h: 5.35 });
    }
  }

  // 16-19. Comps ---------------------------------------------------------
  const compSlides = (kind: "Lease" | "Sale", comps: DeckComp[], mapKey: "leaseComps" | "saleComps") => {
    const s = slide(`${kind} Comps`);
    if (!comps.length) s.placeholder(`No ${kind.toLowerCase()} comps in Hopper within ${input.compRadiusMiles} miles and 24 months. Add comps on the Comps page.`, { x: 0.3, y: 1.45, w: 9.4, h: 4 });
    else if (kind === "Lease") {
      s.table(["#", "Address", "Date", "Bldg SF", "Land", "Rent (as quoted)", "$/SF Bldg/Mo", "Tenant", "Dist."],
        comps.map((c) => [String(c.n), [c.address, c.city].filter(Boolean).join(", "), `${date(c.date)}${c.dateEstimated ? "*" : ""}`, n0(c.buildingSf), ac(c.acres), c.quoted, c.normalized, c.party ?? "—", c.distanceMi == null ? "—" : `${c.distanceMi.toFixed(1)} mi`]),
        { x: 0.3, y: 1.45, w: 9.4, h: 4.8 }, { size: 8, widths: [0.3, 2.4, 0.85, 0.8, 0.7, 1.4, 0.9, 1.3, 0.6], align: ["ctr", "l", "r", "r", "r", "r", "r", "l", "r"], rowHeight: 0.3 });
    } else {
      s.table(["#", "Address", "Closed", "Bldg SF", "Land", "Price", "$/SF Bldg", "Cap Rate", "Buyer", "Dist."],
        comps.map((c) => [String(c.n), [c.address, c.city].filter(Boolean).join(", "), date(c.date), n0(c.buildingSf), ac(c.acres), c.quoted, c.normalized, c.capRate == null ? "—" : pct(c.capRate, 2), c.party ?? "—", c.distanceMi == null ? "—" : `${c.distanceMi.toFixed(1)} mi`]),
        { x: 0.3, y: 1.45, w: 9.4, h: 4.8 }, { size: 8, widths: [0.3, 2.3, 0.85, 0.8, 0.7, 1.05, 0.85, 0.7, 1.2, 0.6], align: ["ctr", "l", "r", "r", "r", "r", "r", "r", "l", "r"], rowHeight: 0.3 });
    }
    s.text([{ runs: [{ text: `Hopper comp repository: ranked by recency, distance, size and coverage within ${input.compRadiusMiles} miles and 24 months.${kind === "Lease" ? " * Date estimated from lease expiration." : ""}`, color: MUTED }] }], { x: 0.3, y: 6.55, w: 9.4, h: 0.35 }, { size: 8 });
    s.notes.push(`Hopper comps: ${comps.map((c) => `#${c.n} ${c.address}`).join("; ") || "none in range"}.`);
    const map = slide(`${kind} Comps`);
    mapOrPlaceholder(map, mapKey, `Map of the ${kind.toLowerCase()} comps, numbered to match the table.`, { x: 0.3, y: 1.42, w: 9.4, h: 5.45 });
  };
  compSlides("Lease", input.leaseComps, "leaseComps");
  compSlides("Sale", input.saleComps, "saleComps");

  // 20-21. Portfolio -----------------------------------------------------
  {
    const where = deal.market || cityState;
    const s = slide(`${where} Portfolio Context`);
    if (input.assets.length) mapOrPlaceholder(s, "portfolio", `Map of owned ${where} assets with the subject.`, { x: 0.3, y: 1.42, w: 9.4, h: 5.45 });
    else s.placeholder(`No owned assets recorded in ${where}.`, { x: 0.3, y: 1.42, w: 9.4, h: 5.45 });
    const t = slide("Portfolio Summary");
    if (input.assets.length) {
      t.table(["#", "Address", "City", "Site AC", "Bldg SF", "Status", "Occupancy", "Dist. to Subject"],
        input.assets.map((a, i) => [String(i + 1), a.address, a.city ?? "—", a.acres?.toFixed(2) ?? "—", n0(a.buildingSf), a.status, a.occupancy ?? "—", a.distanceMi == null ? "—" : `${a.distanceMi.toFixed(1)} mi`]),
        { x: 0.3, y: 1.45, w: 9.4, h: 5 }, { size: 8, widths: [0.3, 2.6, 1.2, 0.8, 0.9, 0.9, 0.9, 1.1], align: ["ctr", "l", "l", "r", "r", "l", "l", "r"], rowHeight: 0.26 });
    } else t.placeholder(`No owned assets recorded in ${where}.`, { x: 0.3, y: 1.45, w: 9.4, h: 3 });
    t.notes.push("Hopper owned-asset records (Our assets).");
  }

  // 22. Pursuit terms ----------------------------------------------------
  {
    const s = slide("Pursuit Terms");
    const recorded = deal.contractPrice ?? deal.lastOffer?.price ?? null;
    const rows: string[][] = [
      ["Purchase price (model)", usd(price)],
      ...(recorded !== null ? [[deal.contractPrice ? "Contract price (Hopper)" : "Latest offer (Hopper)", usd(recorded)]] : []),
      ["Deposit", deal.loi.depositAmount ? (/^\$/.test(deal.loi.depositAmount) ? deal.loi.depositAmount : "$" + deal.loi.depositAmount) : "—"],
      ["Due diligence period", deal.loi.ddDays ? `${deal.loi.ddDays} days` : "—"],
      ["Closing period", deal.loi.closingDays ? `${deal.loi.closingDays} days after DD` : "—"],
      ["Estimated DD expiration", date(deal.ddEndOn)],
      ["Estimated closing", date(deal.closingOn ?? m.dates.acquisition)],
    ];
    s.table(["Pursuit Terms", ""], rows, { x: 2.25, y: 1.8, w: 5.5, h: 3 }, { size: 11, widths: [2.6, 2], align: ["l", "r"], rowHeight: 0.36 });
    if (recorded !== null && price !== null && Math.abs(recorded - price) > 1) {
      s.text([{ runs: [{ text: `The model is at ${usd(price)}; Hopper records ${usd(recorded)}. Confirm which price IC is approving.`, color: "B4541A", bold: true }] }], { x: 2.25, y: 4.95, w: 5.5, h: 0.5 }, { size: 10 });
    }
    s.notes.push("Model price from ES Summary; deposit and periods from the deal's last saved LOI terms; dates from the deal record.");
  }

  // 23. DD budget ----------------------------------------------------------
  {
    const s = slide("Due Diligence Budget");
    s.table(["Deposits", "Dalfen", "Partner", "Total"], [["Refundable deposit", "", "", deal.loi.depositAmount ? (/^\$/.test(deal.loi.depositAmount) ? deal.loi.depositAmount : "$" + deal.loi.depositAmount) : ""], ["Total", "", "", ""]],
      { x: 1.5, y: 1.6, w: 7, h: 0.9 }, { size: 10, widths: [2.4, 1, 1, 1], align: ["l", "r", "r", "r"], emphasis: [1], rowHeight: 0.3 });
    s.table(["Projected Diligence Costs", "Dalfen", "Partner", "Total"], [["Phase I", "", "", ""], ["Zoning", "", "", ""], ["Title search", "", "", ""], ["Legal", "", "", ""], ["Contingency", "", "", ""], ["Total", "", "", ""]],
      { x: 1.5, y: 2.9, w: 7, h: 2.2 }, { size: 10, widths: [2.4, 1, 1, 1], align: ["l", "r", "r", "r"], emphasis: [5], rowHeight: 0.3 });
    s.text([OPEN("enter quotes and the partner split; Hopper does not hold diligence budgets")], { x: 1.5, y: 5.2, w: 7, h: 0.4 }, { size: 9 });
  }

  // ---- assemble ---------------------------------------------------------
  zip.file("ppt/slideLayouts/slideLayout2.xml", zip.file("ppt/slideLayouts/slideLayout2.xml")!.asText().replace(/\{\{PROPERTY\}\}/g, property.replace(/&/g, "&amp;").replace(/</g, "&lt;")));
  let types = zip.file("[Content_Types].xml")!.asText();
  for (const s of slides) {
    zip.file(`ppt/slides/slide${s.number}.xml`, s.xml());
    const rels = [`<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout${s.number === 1 ? 1 : 2}.xml"/>`, `<Relationship Id="rIdNotes" Type="${R_NS}/notesSlide" Target="../notesSlides/notesSlide${s.number}.xml"/>`];
    s.pictures.forEach((p, i) => {
      const name = `ic-${s.number}-${i + 1}.${p.ext}`;
      zip.file(`ppt/media/${name}`, p.bytes);
      rels.push(`<Relationship Id="${p.rid}" Type="${R_NS}/image" Target="../media/${name}"/>`);
    });
    zip.file(`ppt/slides/_rels/slide${s.number}.xml.rels`, `<Relationships xmlns="${REL_NS}">${rels.join("")}</Relationships>`);
    zip.file(`ppt/notesSlides/notesSlide${s.number}.xml`, s.notesXml());
    zip.file(`ppt/notesSlides/_rels/notesSlide${s.number}.xml.rels`, `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${R_NS}/slide" Target="../slides/slide${s.number}.xml"/></Relationships>`);
    types = types.replace("</Types>", `<Override PartName="/ppt/notesSlides/notesSlide${s.number}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`);
  }
  if (slides.length !== 23) throw new Error(`Deck has ${slides.length} slides; the template has 23.`);
  zip.file("[Content_Types].xml", types);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
