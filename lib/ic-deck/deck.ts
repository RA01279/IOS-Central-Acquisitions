// lib/ic-deck/deck.ts
//
// The IC executive summary, in the Aldine reference order (24 slides). Every
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
import type { NarrativeKey, NarrativeSection } from "../agents/ic-narrative";
import { projectToView, type MarketCanvas, type CanvasRow, type MapView } from "./canvas";
import type { TaxSummary } from "../property-taxes/summary";
import { MUTED, NAVY, R_NS, REL_NS, SlideBuilder, type Picture, type Para } from "./pptx-kit";
import { REFERENCE_EXHIBIT_SLIDES, validateReference, referenceBudget } from "./reference";

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
  normalizedUnit?: string;
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
  compRadii?: { lease: number; sale: number };
  assets: DeckAsset[];
  /** Sourced agent drafts for the sections Hopper can't fill. Optional. */
  narrative?: { sections: Record<NarrativeKey, NarrativeSection>; runAt: string };
  /** Computed site exhibits (parcel outline, highway access); null = not found. */
  site?: {
    parcel: { acres: number; parcelCount: number; dealAcres: number | null; matchesDeal: boolean | null; owner: string | null; source: string } | null;
    highway: { caption: string; source: string } | null;
    /** IOS inventory around the site (slides 12-15), with each map's legend colors. */
    canvas?: (MarketCanvas & { view: MapView; legends: Record<"occupancy" | "tenantUse" | "owner", Record<string, string>> }) | null;
  };
  /** Researched property tax bills (Property Taxes workspace), latest year. */
  taxes?: TaxSummary | null;
  maps: Partial<Record<"coverPhoto" | "coverAerial" | "location" | "aerial" | "aerialClose" | "leaseComps" | "saleComps" | "portfolio" | "canvasOccupancy" | "canvasTenancy" | "canvasOwnership", Picture>>;
  preparedOn: Date;
  reference?: { bytes: Uint8Array; name: string };
}

// ---- formatting -------------------------------------------------------------
const usd = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${v < 0 ? "(" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}${v < 0 ? ")" : ""}`);
const n0 = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "(" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")}${v < 0 ? ")" : ""}`);
const sf = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString("en-US")} SF`);
const pct = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
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
const DRAFT_TAG = { text: "  Sourced draft — verify", color: "B4541A", italic: true, bold: false, size: 7 };

export function renderIcDeck(input: IcDeckInput): Buffer {
  const { model: m, deal } = input;
  const zip = input.reference
    ? validateReference(input.reference.bytes, input.deal.address)
    : new PizZip(readFileSync(join(process.cwd(), "lib/ic-deck/templates/ic-deck.pptx")));
  const property = deal.address || m.property.address || "Subject property";
  const sourceBudget = input.reference ? referenceBudget(zip) : null;
  const cityState = m.property.cityState ?? [deal.city, deal.state].filter(Boolean).join(", ");
  const tenants = m.rentRoll.rows.map((r) => r.tenant);
  // Leased share of the rent roll's own total: IOS rent rolls are often in land SF
  // (the model basis), so dividing by building SF overstated occupancy (e.g. 1,023%).
  const leasedSf = m.rentRoll.rows.filter((r) => !/vacan/i.test(r.tenant)).reduce((s, r) => s + (r.sf ?? 0), 0);
  const occupiedRaw = m.rentRoll.totalSf ? leasedSf / m.rentRoll.totalSf : m.property.buildingSf ? leasedSf / m.property.buildingSf : null;
  const occupied = occupiedRaw != null && occupiedRaw <= 1.0005 ? Math.min(occupiedRaw, 1) : null;
  const price = m.capitalization.find((c) => /price/i.test(c.label))?.amount ?? null;
  const pricePsf = m.capitalization.find(c => /price/i.test(c.label))?.psf;
  const denominator = price && pricePsf && m.property.siteSf && Math.abs(price / m.property.siteSf - pricePsf) / pricePsf < .02 ? "land" : price && pricePsf && m.property.buildingSf && Math.abs(price / m.property.buildingSf - pricePsf) / pricePsf < .02 ? "building" : "model basis";
  const hold = m.returns.holdYears;
  const holdTag = `${hold ?? "?"}-Yr Hold; ${pct(m.yields.exitCap, 2)} exit`;
  const source = `Model: ${m.source.fileName}${m.source.modelDate ? ` (as of ${date(m.source.modelDate)})` : ""}`;
  const footer = `DRAFT for IC review · Built ${date(input.preparedOn.toISOString())}${m.source.modelDate ? ` · Model as of ${date(m.source.modelDate)}` : ""} · Sources in slide notes`;
  const slides: SlideBuilder[] = [];
  // Agent drafts: bullets on the slide, every source and unconfirmed lead in the notes.
  const narrative = input.narrative;
  const drafted = (key: NarrativeKey) => (narrative?.sections[key].bullets.length ? narrative.sections[key] : null);
  const noteDraft = (s: SlideBuilder, key: NarrativeKey, title: string) => {
    const sec = narrative?.sections[key];
    if (!sec) return;
    s.notes.push(`${title} — agent draft (IC deck narrative, ${narrative!.runAt || "date unknown"}). Verify each point against its source before circulating.`);
    s.notes.push(...sec.sources.map((x) => "Source: " + x), ...sec.unverified.map((x) => "Unverified: " + x));
  };
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
    const strategy = deal.acquisitionType && /leaseback|slb/i.test(deal.acquisitionType) ? "Sale-Leaseback Opportunity" : occupied !== null && occupied >= 0.999 ? "Occupied Opportunity" : occupied ? "Value-Add Opportunity" : "Opportunity";
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

  // Property taxes: the model's Year 1 line vs. the latest researched bill.
  // A partial bill (e.g. county collector only) is a floor: a model below it is understated.
  const tax = input.taxes ?? null, modelTax = m.realEstateTaxes ?? null;
  const taxGap = tax && modelTax != null && tax.amount > 0 ? modelTax / tax.amount - 1 : null;
  const taxFlag = taxGap == null ? null
    : tax!.status === "partial" ? (taxGap < 0 ? `Model Year 1 taxes are ${pct(-taxGap, 0)} below a partial ${tax!.year} bill, so they are understated.` : null)
    : Math.abs(taxGap) > 0.1 ? `Model Year 1 taxes are ${pct(Math.abs(taxGap), 0)} ${taxGap < 0 ? "below" : "above"} the ${tax!.year} bill.` : null;
  const taxScope = !tax ? "" : tax.status === "complete" ? "all taxing authorities, reconciled" : `partial: ${(tax.caveats[0] ?? "coverage unverified").replace(/\.$/, "").replace(/^[\w-]+: /, "")}`;
  const taxPara = (): Para[] => tax
    ? [{ runs: [{ text: `Property taxes: ${modelTax != null ? `${usd(modelTax)} Year 1 in the model vs. ` : ""}${usd(tax.amount)} ${tax.year} bill (${taxScope}).` }, ...(taxFlag ? [{ text: " " + taxFlag, bold: true, color: "B4541A" }] : [])], bullet: true }]
    : modelTax != null ? [{ runs: [{ text: `Property taxes: ${usd(modelTax)} Year 1 in the model. ` }, ...OPEN("no researched tax bill yet; run research on the Property Taxes page").runs], bullet: true }] : [];

  // 2. Executive Summary --------------------------------------------------
  {
    const s = slide("Executive Summary");
    const tiles: Array<[string, string]> = [
      [pct(m.returns.levered.irr), `GLIRR (${holdTag})`],
      [pct(m.returns.unlevered.irr), `GUIRR (${holdTag})`],
      [mult(m.returns.levered.multiple), `Equity Multiple (${holdTag})`],
      [pct(m.yields.goingIn, 2), "Going-in Cap Rate"],
      [pct(m.returns.lp.irr), `Levered LP IRR (${holdTag})`],
      [pct(m.yields.returnOnCostAtExit, 2), "Yield-to-Cost at Exit"],
    ];
    tiles.forEach(([big, small], i) => {
      const x = 0.2 + i * 1.6;
      s.rect({ x, y: 1.36, w: 1.5, h: 0.72 }, "EEF2F7");
      s.text([{ runs: [{ text: big, bold: true, size: 15, color: NAVY }], align: "ctr", spaceAfter: 0 }, { runs: [{ text: small, size: 7, color: MUTED }], align: "ctr" }], { x, y: 1.36, w: 1.5, h: 0.72 }, { anchor: "ctr" });
    });
    const fees = m.totalCost.amount !== null && price !== null ? m.totalCost.amount - price : null;
    const status = deal.contractPrice ? `Under contract at ${usd(deal.contractPrice)}` : deal.lastOffer ? `Offer of ${usd(deal.lastOffer.price)} submitted ${date(deal.lastOffer.date)}` : `Stage: ${deal.stageLabel}`;
    const terms = [deal.loi.depositAmount && `deposit of ${/^\$/.test(deal.loi.depositAmount) ? deal.loi.depositAmount : "$" + deal.loi.depositAmount}`, deal.loi.ddDays && `${deal.loi.ddDays} days due diligence`, deal.loi.closingDays && `${deal.loi.closingDays} days to close`].filter(Boolean).join("; ");
    const head = (t: string): Para => ({ runs: [{ text: t, bold: true, color: NAVY, size: 10 }], spaceAfter: 1 });
    const body = (t: string): Para => ({ runs: [{ text: t, size: 9 }], bullet: true, spaceAfter: 2 });
    const tenantLine = tenants.length ? `leased to ${tenants.join(", ").replace(/\.$/, "")}` : "currently vacant";
    s.text([
      head("Site Overview"),
      body(`${pct(occupied, 2)} leased IOS site in ${cityState} on ${m.property.acres?.toFixed(2) ?? "—"} acres with a ${sf(m.property.buildingSf)} building (${pct(m.property.coverage, 2)} coverage), ${tenantLine}.`),
      body(`Going-in basis of ${usd(pricePsf, 2)}/SF ${denominator} (${usd(price)} purchase price); all-in cost of ${usd(m.totalCost.psf, 2)}/SF ${denominator} (${usd(m.totalCost.amount)}).`),
      drafted("locationHighlights") ? { runs: [{ text: "Location Highlights", bold: true, color: NAVY, size: 10 }, DRAFT_TAG], spaceAfter: 1 } : head("Location Highlights"),
      ...(drafted("locationHighlights")?.bullets.slice(0, 2).map(body) ?? [OPEN("highway access, submarket, nearby demand drivers")]),
      head("Business Plan — Model Assumptions"),
      body(`${deal.acquisitionType && /leaseback|slb/i.test(deal.acquisitionType) ? "Sale-leaseback" : "Acquisition"}${tenants.length ? ` with ${tenants.join(", ")}` : " with vacancy at closing"}; ${m.rentRoll.rows[0]?.expiration ? `recorded lease expiration ${date(m.rentRoll.rows[0].expiration)}.` : "lease timing requires confirmation."}`),
      body(`Capital improvements budget: ${usd(m.capitalization.find(c => /capex|capital improvements/i.test(c.label))?.amount)}. ${m.rentRoll.rows[0]?.downtimeMonths ?? "Unspecified"} months modeled downtime; ${m.rentRoll.rows[0]?.marketPsfMonthly != null ? usd(m.rentRoll.rows[0].marketPsfMonthly, 2) + "/building SF/month market rent." : "market rent requires confirmation."}`),
      head("Deal Status"),
      body(status + (terms ? `; ${terms}.` : ".")),
      drafted("zoning") ? { runs: [{ text: "Zoning", bold: true, color: NAVY, size: 10 }, DRAFT_TAG], spaceAfter: 1 } : head("Zoning"),
      ...(drafted("zoning")?.bullets.slice(0, 2).map(body) ?? [OPEN("governing jurisdiction, district and outdoor-storage rights (see Site research agent)")]),
      head("Underwriting Assumptions"),
      body(`${hold ?? "—"}-year hold; ${pct(m.yields.exitCap, 2)} exit cap on a ${pct(m.yields.returnOnCostAtExit, 2)} yield-to-cost; ${usd(fees)} of acquisition, financing and other costs capitalized into the ${usd(m.totalCost.psf, 2)}/SF ${denominator} all-in basis.`),
      body(`Debt: ${pct(m.debt.ltc, 2)} LTC (${usd(m.debt.loan)}), ${pct(m.debt.index, 2)} index + ${pct(m.debt.spread, 2)} spread, ${m.debt.interestOnlyMonths ?? "—"} months interest-only.`),
      ...taxPara(),
    ], { x: 0.2, y: 2.2, w: 5.45, h: 4.72 }, { size: 9 });
    const right = 5.8, w = 3.98;
    s.table(["Site", ""], [
      ["Address", property], ["City, State", cityState], ["Tenant", tenants.join(", ") || "Vacant"],
      ["Site AC", m.property.acres?.toFixed(2) ?? "—"], ["Site SF", n0(m.property.siteSf)], ["Building SF", n0(m.property.buildingSf)], ["Coverage %", pct(m.property.coverage, 2)],
    ], { x: right, y: 2.2, w, h: 1.9 }, { size: 8, widths: [1.1, 1.9], align: ["l", "r"], rowHeight: 0.22 });
    s.table(["Capitalization", "$ Amount", `$/SF ${denominator}`], [
      ...m.capitalization.map((c) => [c.label, usd(c.amount), usd(c.psf, 2)]),
      ["Total", usd(m.totalCost.amount), usd(m.totalCost.psf, 2)],
    ], { x: right, y: 4.15, w, h: 1.5 }, { size: 8, widths: [1.7, 1, 0.8], align: ["l", "r", "r"], emphasis: [m.capitalization.length], rowHeight: 0.2 });
    s.table(["Yields", "% Cap Rate"], [
      ["Going-in", pct(m.yields.goingIn, 2)], ["Return on Cost at Exit", pct(m.yields.returnOnCostAtExit, 2)], ["Exit Cap", pct(m.yields.exitCap, 2)],
    ], { x: right, y: 5.65 + 0.2 * Math.max(0, m.capitalization.length - 4), w, h: 0.8 }, { size: 8, widths: [2.2, 1], align: ["l", "r"], rowHeight: 0.2 });
    s.notes.push(source + ": ES Summary, Pro Forma returns block and debt terms.", `Hopper deal record: stage ${deal.stageLabel}; LOI terms as last saved.`);
    noteDraft(s, "locationHighlights", "Location Highlights");
    noteDraft(s, "zoning", "Zoning");
    if (m.warnings.length) s.notes.push("MODEL CHECKS — resolve before circulating:", ...m.warnings.map((x) => "• " + x));
  }

  // 3-5. Location and aerials --------------------------------------------
  {
    const s = slide("Location Overview");
    mapOrPlaceholder(s, "location", "Location map of the subject in its metro.", { x: 0.3, y: 1.42, w: 9.4, h: 5.45 });
    const s4 = slide("Aerial Overview");
    mapOrPlaceholder(s4, "aerial", "Aerial of the subject with highway access annotated.", { x: 0.3, y: 1.42, w: 9.4, h: 5.0 });
    const hw = input.site?.highway;
    s4.text([hw ? { runs: [{ text: hw.caption, bold: true, color: NAVY }] } : OPEN("annotate nearest highway / interchange and drive time")], { x: 0.3, y: 6.47, w: 9.4, h: 0.45 }, { size: 10 });
    if (hw) s4.notes.push(hw.source, "Map: H = closest point of the highway (white route); R = nearest on-ramp (yellow route).");
    const s5 = slide("Aerial Snapshot");
    mapOrPlaceholder(s5, "aerialClose", "Close aerial of the site with the yard outlined.", { x: 0.3, y: 1.42, w: 9.4, h: 5.0 });
    const pc = input.site?.parcel;
    const parcelLine: Para | null = !pc ? null : pc.matchesDeal === false
      ? { runs: [{ text: `Parcel outline: ${pc.acres.toFixed(2)} AC (${pc.parcelCount} parcel${pc.parcelCount === 1 ? "" : "s"} of ${pc.owner ?? "the owner of record"}) vs ${pc.dealAcres?.toFixed(2)} AC underwritten — confirm the site boundary.`, bold: true, color: "B4541A" }] }
      : { runs: [{ text: `Parcel outline: ${pc.acres.toFixed(2)} AC${pc.parcelCount > 1 ? ` across ${pc.parcelCount} parcels` : ""}${pc.matchesDeal ? `, matching the ${pc.dealAcres?.toFixed(2)} AC underwritten` : ""}.`, bold: true, color: NAVY }] };
    s5.text([...(parcelLine ? [parcelLine] : [OPEN("outline the parcel")]), OPEN("usable outdoor-storage acreage")], { x: 0.3, y: 6.42, w: 9.4, h: 0.55 }, { size: 9 });
    if (pc) s5.notes.push(`Parcel boundary: ${pc.source}; owner of record ${pc.owner ?? "unknown"}. Touching parcels with the same owner are included. Acreage computed from the boundary.`);
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
    const t = drafted("tenant"), credit = drafted("tenantCredit");
    s.text([
      ...(t ? [{ runs: [{ text: tenants.join(", ") || "Tenant", bold: true, color: NAVY }, DRAFT_TAG] } as Para, ...t.bullets.slice(0, credit ? 4 : 5).map((b): Para => ({ runs: [{ text: b }], bullet: true }))]
        : [OPEN(`${tenants.join(", ") || "tenant"}: business, history, ownership, end markets and use of the site`)]),
      ...(credit ? [{ runs: [{ text: "Credit — public information only; verify with tenant financials", bold: true, color: NAVY }, DRAFT_TAG], spaceAfter: 1 } as Para, ...credit.bullets.slice(0, 3).map((b): Para => ({ runs: [{ text: b }], bullet: true }))] : []),
      OPEN("tenant financials reviewed, guaranty and security deposit — do not assert creditworthiness without them"),
    ], { x: 0.3, y: 1.45, w: 9.4, h: t ? (credit ? 3.5 : 3.3) : 1.5 }, { size: t ? (credit ? 9 : 10) : 11 });
    s.table(["Tenant", "SF", "Lease Start", "Expiration", "Remaining (mo.)", "Rent / Yr.", "$ / SF / Yr.", "$ / SF / Mo."],
      m.rentRoll.rows.map((r) => [r.tenant, n0(r.sf), date(r.start), date(r.expiration), n0(r.remainingMonths), usd(r.sbrAnnual), r.sbrAnnual && r.sf ? usd(r.sbrAnnual / r.sf, 2) : "—", r.sbrPsfMonthly == null ? "—" : usd(r.sbrPsfMonthly, 2)]),
      { x: 0.3, y: t ? (credit ? 5.05 : 4.1) : 3.1, w: 9.4, h: 1.2 }, { size: 9, widths: [2.2, 0.9, 1, 1, 1, 1.1, 1, 1], align: ["l", "r", "r", "r", "r", "r", "r", "r"] });
    s.notes.push(source + ": Rent Roll.");
    noteDraft(s, "tenant", "Tenant Overview");
    noteDraft(s, "tenantCredit", "Tenant Credit (public information)");
  }

  // 8. Model — base case -------------------------------------------------
  {
    const s = slide("Model – Base Case");
    const leftBottom = s.table(["Sources & Uses", "$ Amount", `$/SF ${denominator}`], [
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
    const keyBottom = s.table(["Key Assumptions", "Base Case"], [
      ["Acquisition date", date(m.dates.acquisition)], ["Sale date", date(m.dates.sale)], ["Hold", `${hold ?? "—"} years`],
      ["Going-in cap", pct(m.yields.goingIn, 2)], ["Return on cost at exit", pct(m.yields.returnOnCostAtExit, 2)], ["Exit cap", pct(m.yields.exitCap, 2)],
      ["Profit", usd(m.returns.profit)],
    ], { x: 5.15, y: returnsBottom + 0.25, w: 4.55, h: 2.1 }, { size: 9, widths: [2.4, 1.8], align: ["l", "r"], rowHeight: 0.26 });
    const debtBottom = s.table(["Debt", "Terms"], [
      ["Loan to purchase price", pct(m.debt.ltpp, 2)], ["Loan to cost", pct(m.debt.ltc, 2)],
      ["Rate", `${pct(m.debt.index, 2)} index + ${pct(m.debt.spread, 2)}`],
      ["Interest-only / amortization", `${m.debt.interestOnlyMonths ?? "—"} / ${m.debt.amortizationMonths ?? "—"} months`],
    ], { x: 0.3, y: leftBottom + 0.25, w: 4.55, h: 1.3 }, { size: 9, widths: [2, 2.1], align: ["l", "r"], rowHeight: 0.26 });
    s.notes.push(source + ": ES Summary and Pro Forma (returns, sources and debt).");
    if (tax || modelTax != null) {
      // Property taxes: model vs. the latest researched bill, with exactly what the bill covers.
      const y = debtBottom + 0.3;
      const rows = [
        ["Model, Year 1 real estate taxes", modelTax != null ? usd(modelTax) : "—"],
        [tax ? `${tax.year} bill${tax.status === "partial" ? " (partial)" : ""}` : "Latest bill", tax ? usd(tax.amount) : "Not researched"],
        ...(tax && modelTax != null ? [["Model vs. bill", `${modelTax - tax.amount < 0 ? "(" : ""}${usd(Math.abs(modelTax - tax.amount))}${modelTax - tax.amount < 0 ? ")" : ""} (${pct(taxGap, 0)})`]] : []),
      ];
      // Compact rows when the tables above leave little room before the footer (6.9").
      const rh = y + 0.26 * (rows.length + 1) <= 6.9 ? 0.26 : Math.max(0.17, (6.9 - y) / (rows.length + 1));
      s.table(["Property Taxes", "$ / year"], rows, { x: 0.3, y, w: 4.55, h: rh * (rows.length + 1) }, { size: rh < 0.24 ? 7.5 : 9, headerSize: rh < 0.24 ? 7.5 : 9, widths: [2.6, 1.5], align: ["l", "r"], rowHeight: rh });
      const lines: Para[] = tax
        ? [{ runs: [{ text: tax.coverage, color: MUTED }] }, ...tax.caveats.slice(0, 3).map((c): Para => ({ runs: [{ text: c, color: "B4541A" }] })), ...(taxFlag ? [{ runs: [{ text: taxFlag, bold: true, color: "B4541A" }] } as Para] : [])]
        : [OPEN("run research on the Property Taxes page or attach the latest bill")];
      const ty = keyBottom + 0.25;
      s.text(lines, { x: 5.15, y: ty, w: 4.55, h: Math.max(0.6, 6.9 - ty) }, { size: 7.5 });
      if (tax) s.notes.push(`Property taxes: Hopper Property Taxes workspace, accounts ${tax.accounts.join(", ")}; history ${tax.history.map((h) => `${h.year} ${h.amount == null ? "incomplete" : usd(h.amount)}`).join(", ")}.`);
    }
  }

  // 9. Market leasing assumptions ---------------------------------------
  {
    const s = slide("Market Leasing Assumptions – Base Case");
    s.table(["Tenant", "Suite", "SF", "% of SF", "Start", "Expiration", "Rem. (mo.)", "MLA", "Renewal", "Downtime"],
      [...m.rentRoll.rows.map((r) => [r.tenant, r.suite ?? "—", n0(r.sf), pct(r.pctSf, 2), date(r.start), date(r.expiration), n0(r.remainingMonths), r.mla ?? "—", pct(r.renewalPct, 2), r.downtimeMonths == null ? "—" : `${r.downtimeMonths} mo.`]),
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
    s.notes.push(source + ": Rent Roll and Market Leasing Summary. Rent PSF is per building SF; the model's MLA is quoted per month.");
  }

  // 10. Cash flow --------------------------------------------------------
  {
    const s = slide("Cash Flow – Base Case");
    const rows = m.cashFlow.rows.map((r) => [r.label, ...r.values.map((v) => (v === null ? "—" : r.format === "pct" ? pct(v, 2) : n0(v)))]);
    const rh = Math.min(0.235, 5.3 / (rows.length + 1));
    s.table(["Annual Cash Flow ($)", ...m.cashFlow.years], rows, { x: 0.3, y: 1.42, w: 9.4, h: 5.3 },
      { size: rows.length > 18 ? 7.5 : 8, widths: [2.6, ...m.cashFlow.years.map(() => 1)], align: ["l", ...m.cashFlow.years.map(() => "r" as const)], emphasis: m.cashFlow.rows.flatMap((r, i) => (r.emphasis ? [i] : [])), rowHeight: rh });
    s.notes.push(source + ": Memo Pro Forma (annual). Figures as last calculated in Excel.");
  }

  // 11. Sensitivities ----------------------------------------------------
  {
    const s = slide("Sensitivity Analysis – Base Case");
    const grids = [m.sensitivities.deal, m.sensitivities.lp];
    const sensitivityChecks = m.warnings.filter(w => /sensitivity|data tables|exit-cap table/i.test(w));
    grids.forEach((g, gi) => {
      const x = gi === 0 ? 0.3 : 5.15;
      s.text([{ runs: [{ text: gi === 0 ? `Deal Returns (${hold ?? "?"}-Yr Hold)` : `LP Returns (${hold ?? "?"}-Yr Hold)`, bold: true, color: NAVY }] }], { x, y: 1.42, w: 4.55, h: 0.3 }, { size: 11 });
      if (sensitivityChecks.length) {
        s.text([{ runs: [{ text: "Model Check — Recalculate Sensitivities", bold: true, color: NAVY }] }, ...sensitivityChecks.slice(0, 4).map(text => ({ runs: [{ text }], bullet: true })), { runs: [{ text: "Correct the price rows and cached data tables in Excel, recalculate, save and upload the current model. Stale grids are withheld from this deck.", bold: true }] }], { x, y: 1.9, w: 4.55, h: 4.2 }, { size: 11 });
        return;
      }
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
  const cv = input.site?.canvas;
  if (cv) {
    const where = deal.submarket || cv.submarket || deal.market || cityState;
    const mk = drafted("market");
    const ac2 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const stale = Date.now() - Date.parse(cv.source.updated) > 365 * 86400000;
    const sourceLine = `Dalfen IOS inventory (ArcGIS: ${cv.source.title}, updated ${cv.source.updated}) — ${cv.total.count} properties within ${cv.radiusMiles} miles of the site. Vacancy is by acreage.`;
    const sourceRuns = [{ text: sourceLine, color: MUTED }, ...(stale ? [{ text: " Inventory is over a year old — confirm it is current.", color: "B4541A", bold: true }] : [])];

    // 12. Tables: tenant usage and owner profile, as in the Golden Spike canvas.
    const s = slide(`${where} IOS Market Canvas`);
    const cols = ["", "Properties", "Gross AC", "% of Total", "Occupied AC", "Vacancy %", "Mean AC", "Std. Dev. AC"];
    const row = (r: CanvasRow, label = r.label) => [label, n0(r.count), ac2(r.acres), pct(r.share), ac2(r.occupiedAcres), pct(r.vacancy), ac2(r.mean), ac2(r.stdev)];
    const opts = (n: number) => ({ size: 8, headerSize: 8, widths: [2.5, 0.95, 1.0, 0.95, 1.05, 0.9, 0.85, 0.95], align: ["l", "r", "r", "r", "r", "r", "r", "r"] as Array<"l" | "r">, emphasis: [n], rowHeight: 0.235 });
    const tenantRows = cv.tenantUse.slice(0, 12);
    s.text([{ runs: [{ text: "Tenant Usage", bold: true, color: NAVY }] }], { x: 0.3, y: 1.4, w: 9.4, h: 0.27 }, { size: 10 });
    let y = s.table(cols, [...tenantRows.map((r) => row(r)), row(cv.total, "Total")], { x: 0.3, y: 1.67, w: 9.4, h: 3.2 }, opts(tenantRows.length));
    s.text([{ runs: [{ text: "Owner Profile", bold: true, color: NAVY }] }], { x: 0.3, y: y + 0.1, w: 9.4, h: 0.27 }, { size: 10 });
    y = s.table(cols, [...cv.ownerType.map((r) => row(r)), row(cv.total, "Total")], { x: 0.3, y: y + 0.37, w: 9.4, h: 1.3 }, opts(cv.ownerType.length));
    s.text([{ runs: sourceRuns }], { x: 0.3, y: Math.min(y + 0.08, 6.5), w: 9.4, h: 0.4 }, { size: 7.5 });
    s.notes.push(`Market canvas source: ${sourceLine}`, "Occupied acreage, verified occupancy, tenant use and owner type are as recorded in the inventory; categories left blank there are counted as Other.");

    // 13-15. Maps colored by occupancy / tenant use / owner type, legend on the right.
    const mapSlide = (sub: string, key: "canvasOccupancy" | "canvasTenancy" | "canvasOwnership", legend: Record<string, string>, rows: CanvasRow[], withMarket: boolean, by: "occupancy" | "tenantUse" | "owner") => {
      const m = slide(`${where} IOS Market Canvas – ${sub}`);
      const pic = input.maps[key];
      if (pic) {
        // Native dots over the fixed map view: crisp, editable, any number of colors.
        const at = m.picture(pic, { x: 0.3, y: 1.42, w: 7.1, h: 5.0 });
        const d = 0.085;
        const known = by === "occupancy" ? new Set(["Leased", "Vacant", "Partially Leased"]) : null;
        let off = 0;
        for (const p of cv.points) {
          const [fx, fy] = projectToView(cv.view, p.lat, p.lng);
          if (fx < 0.01 || fx > 0.99 || fy < 0.01 || fy > 0.99) { off++; continue; }
          const cat = known && !known.has(p.occupancy) ? "Other" : p[by];
          m.rect({ x: at.x + fx * at.w - d / 2, y: at.y + fy * at.h - d / 2, w: d, h: d }, legend[cat] ?? "A0A0A0", "FFFFFF", "ellipse");
        }
        const [sx, sy] = projectToView(cv.view, cv.view.lat, cv.view.lng);
        m.rect({ x: at.x + sx * at.w - 0.09, y: at.y + sy * at.h - 0.09, w: 0.18, h: 0.18 }, NAVY, "FFFFFF", "ellipse");
        m.text([{ runs: [{ text: "S", bold: true, color: "FFFFFF" }], align: "ctr" }], { x: at.x + sx * at.w - 0.12, y: at.y + sy * at.h - 0.11, w: 0.24, h: 0.22 }, { size: 7, anchor: "ctr", autofit: false });
        if (off) m.notes.push(`${off} inventory properties fall outside the map frame and are counted in the tables but not plotted.`);
      } else m.placeholder(`${where} IOS market canvas map — ${sub.toLowerCase()}.`, { x: 0.3, y: 1.42, w: 7.1, h: 5.0 });
      let ly = 1.45;
      const shown = rows.slice(0, 12);
      for (const r of shown) {
        m.rect({ x: 7.55, y: ly + 0.06, w: 0.13, h: 0.13 }, legend[r.label] ?? "A0A0A0", undefined, "ellipse");
        m.text([{ runs: [{ text: r.label }, { text: `  ${r.count}`, color: MUTED }] }], { x: 7.73, y: ly, w: 2.05, h: 0.25 }, { size: 8, autofit: false });
        ly += 0.25;
      }
      m.rect({ x: 7.55, y: ly + 0.04, w: 0.17, h: 0.17 }, NAVY, "FFFFFF", "ellipse");
      m.text([{ runs: [{ text: "S", bold: true }, { text: `  Subject site; ring = ${cv.radiusMiles} mi`, color: MUTED }] }], { x: 7.73, y: ly, w: 2.05, h: 0.25 }, { size: 8, autofit: false });
      ly += 0.4;
      if (withMarket && mk) {
        m.text([{ runs: [{ text: "Market", bold: true, color: NAVY }, DRAFT_TAG] }, ...mk.bullets.slice(0, 4).map((b): Para => ({ runs: [{ text: b }], bullet: true }))], { x: 7.5, y: ly, w: 2.3, h: 6.75 - ly }, { size: 7.5 });
        noteDraft(m, "market", "Market");
      }
      m.text([{ runs: sourceRuns }], { x: 0.3, y: 6.47, w: 7.1, h: 0.45 }, { size: 7 });
    };
    // Occupancy categories in a fixed order, counted from the plotted points.
    const occCount = (k: string) => cv.points.filter((p) => (k === "Other" ? !["Leased", "Vacant", "Partially Leased"].includes(p.occupancy) : p.occupancy === k)).length;
    const occRows = ["Leased", "Vacant", "Partially Leased", "Other"].map((k) => ({ label: k, count: occCount(k) } as CanvasRow)).filter((r) => r.count > 0);
    mapSlide("Occupancy Breakdown", "canvasOccupancy", cv.legends.occupancy, occRows, true, "occupancy");
    mapSlide("Tenancy Breakdown", "canvasTenancy", cv.legends.tenantUse, cv.tenantUse, false, "tenantUse");
    mapSlide("Ownership Breakdown", "canvasOwnership", cv.legends.owner, cv.ownerType, false, "owner");
  } else {
    const where = deal.submarket || deal.market || cityState;
    const mk = drafted("market");
    for (const sub of ["", " – Occupancy Breakdown", " – Tenancy Breakdown", " – Ownership Breakdown"]) {
      const s = slide(`${where} IOS Market Canvas${sub}`);
      const what = `${where} IOS market canvas${sub.replace(" – ", ": ").toLowerCase()} exhibit, with survey source and date.`;
      if (sub === "" && mk) {
        s.text([{ runs: [{ text: "Market", bold: true, color: NAVY }, DRAFT_TAG] }, ...mk.bullets.map((b): Para => ({ runs: [{ text: b }], bullet: true }))], { x: 0.3, y: 1.45, w: 3.6, h: 5.35 }, { size: 9.5 });
        s.placeholder(what, { x: 4.05, y: 1.45, w: 5.65, h: 5.35 });
        noteDraft(s, "market", "Market");
      } else s.placeholder(what, { x: 0.3, y: 1.45, w: 9.4, h: 5.35 });
    }
  }

  // 16-19. Comps ---------------------------------------------------------
  const compSlides = (kind: "Lease" | "Sale", comps: DeckComp[], mapKey: "leaseComps" | "saleComps") => {
    const radius = input.compRadii?.[kind === "Lease" ? "lease" : "sale"] ?? input.compRadiusMiles;
    const s = slide(`${kind} Comps`);
    if (!comps.length) s.placeholder(`No ${kind.toLowerCase()} comps in Hopper within ${radius} miles and 24 months. Add comps on the Comps page.`, { x: 0.3, y: 1.45, w: 9.4, h: 4 });
    else if (kind === "Lease") {
      s.table(["#", "Address", "Date", "Bldg SF", "Site AC", "Rent (as quoted)", comps[0]?.normalizedUnit ?? "$/SF Bldg/Mo", "Tenant", "Dist."],
        comps.map((c) => [String(c.n), [c.address, c.city].filter(Boolean).join(", "), `${date(c.date)}${c.dateEstimated ? "*" : ""}`, n0(c.buildingSf), ac(c.acres), c.quoted, c.normalized, c.party ?? "—", c.distanceMi == null ? "—" : `${c.distanceMi.toFixed(1)} mi`]),
        { x: 0.3, y: 1.45, w: 9.4, h: 4.8 }, { size: 8, widths: [0.3, 2.4, 0.85, 0.8, 0.7, 1.4, 0.9, 1.3, 0.6], align: ["ctr", "l", "r", "r", "r", "r", "r", "l", "r"], rowHeight: 0.3 });
    } else {
      s.table(["#", "Address", "Closed", "Bldg SF", "Site AC", "Price", comps[0]?.normalizedUnit ?? "$/SF Bldg", "Cap Rate", "Buyer", "Dist."],
        comps.map((c) => [String(c.n), [c.address, c.city].filter(Boolean).join(", "), date(c.date), n0(c.buildingSf), ac(c.acres), c.quoted, c.normalized, c.capRate == null ? "—" : pct(c.capRate, 2), c.party ?? "—", c.distanceMi == null ? "—" : `${c.distanceMi.toFixed(1)} mi`]),
        { x: 0.3, y: 1.45, w: 9.4, h: 4.8 }, { size: 8, widths: [0.3, 2.3, 0.85, 0.8, 0.7, 1.05, 0.85, 0.7, 1.2, 0.6], align: ["ctr", "l", "r", "r", "r", "r", "r", "r", "l", "r"], rowHeight: 0.3 });
    }
    s.text([{ runs: [{ text: `Hopper comp repository: ranked by recency, distance, size and coverage within ${radius} miles and 24 months.${kind === "Lease" ? " * Date estimated from lease expiration." : ""}`, color: MUTED }] }], { x: 0.3, y: 6.55, w: 9.4, h: 0.35 }, { size: 8 });
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
    const pf = slide(`${where} Pro Forma Portfolio`);
    const knownSf = input.assets.reduce((sum, a) => sum + (a.buildingSf ?? 0), 0);
    const knownAc = input.assets.reduce((sum, a) => sum + (a.acres ?? 0), 0);
    pf.table(["Portfolio", "Assets", "Recorded Building SF", "Recorded Site AC"], [
      ["Owned within 50 miles", String(input.assets.length), n0(knownSf), ac(knownAc)],
      ["Proposed acquisition", "1", n0(m.property.buildingSf), ac(m.property.acres)],
      ["Pro forma (subject added)", String(input.assets.length + 1), n0(knownSf + (m.property.buildingSf ?? 0)), ac(knownAc + (m.property.acres ?? 0))],
    ], { x: 0.3, y: 1.65, w: 9.4, h: 2 }, { size: 11, emphasis: [2], align: ["l", "r", "r", "r"], rowHeight: 0.42 });
    pf.text(`Subject purchase price: ${usd(price)}; all-in cost: ${usd(m.totalCost.amount)}. Recorded area totals exclude assets with missing sizes; these are not total market inventory or portfolio valuations. The acquisition is proposed, not an asset already owned.`, { x: 0.3, y: 3.8, w: 9.4, h: 1.2 }, { size: 11 });
    pf.notes.push(source, "Hopper owned assets within 50 miles of the subject, capped at the nearest 15. Does not imply portfolio NOI, value or returns; those require the portfolio model.");
    const t = slide("Portfolio Breakdown");
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
      ...(sourceBudget?.total != null ? [["Diligence budget (source snapshot)", usd(sourceBudget.total)]] : []),
    ];
    s.table(["Pursuit Terms", ""], rows, { x: 2.25, y: 1.8, w: 5.5, h: 3 }, { size: 11, widths: [2.6, 2], align: ["l", "r"], rowHeight: 0.36 });
    if (recorded !== null && price !== null && Math.abs(recorded - price) > 1) {
      s.text([{ runs: [{ text: `The model is at ${usd(price)}; Hopper records ${usd(recorded)}. Confirm which price IC is approving.`, color: "B4541A", bold: true }] }], { x: 2.25, y: 4.95, w: 5.5, h: 0.5 }, { size: 10 });
    }
    const budgetCheck = m.warnings.find(w => /retained budget uses/i.test(w));
    if (budgetCheck) s.text(budgetCheck, { x: 2.25, y: 5.65, w: 5.5, h: 0.9 }, { size: 10, color: "B4541A", bold: true });
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
  for (const [ext, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"]]) {
    if (!types.includes(`Extension="${ext}"`)) types = types.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
  }
  for (const s of slides) {
    if (input.reference && REFERENCE_EXHIBIT_SLIDES.includes(s.number)) {
      // Keep the entire original package: pictures, crops, groups, tables,
      // embedded workbooks and fonts remain intact and editable.
      s.notes = [`Source exhibit retained from ${input.reference.name}. Same-property source snapshot; review dates, tenant information, survey coverage and budget before circulating.`];
      zip.file(`ppt/notesSlides/notesSlide${s.number}.xml`, s.notesXml());
      const path = `ppt/slides/_rels/slide${s.number}.xml.rels`;
      let rel = zip.file(path)!.asText();
      const note = /<Relationship\b[^>]*Type="[^"]*\/notesSlide"[^>]*\/>/;
      const link = `<Relationship Id="rIdSourceNotes" Type="${R_NS}/notesSlide" Target="../notesSlides/notesSlide${s.number}.xml"/>`;
      rel = note.test(rel) ? rel.replace(note, link) : rel.replace("</Relationships>", link + "</Relationships>");
      zip.file(path, rel);
      zip.file(`ppt/notesSlides/_rels/notesSlide${s.number}.xml.rels`, `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${R_NS}/slide" Target="../slides/slide${s.number}.xml"/></Relationships>`);
      const part = `/ppt/notesSlides/notesSlide${s.number}.xml`;
      if (!types.includes(`PartName="${part}"`)) types = types.replace("</Types>", `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`);
      continue;
    }
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
    for (const [part, kind] of [[`/ppt/slides/slide${s.number}.xml`, "slide"], [`/ppt/notesSlides/notesSlide${s.number}.xml`, "notesSlide"]]) {
      if (!types.includes(`PartName="${part}"`)) types = types.replace("</Types>", `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml"/></Types>`);
    }
  }
  if (slides.length !== 24) throw new Error(`Deck has ${slides.length} slides; expected 24.`);
  const ids = slides.map(s => `<p:sldId id="${256 + s.number}" r:id="rIdDeckSlide${s.number}"/>`).join("");
  zip.file("ppt/presentation.xml", zip.file("ppt/presentation.xml")!.asText().replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`));
  const deckRels = zip.file("ppt/_rels/presentation.xml.rels")!.asText().replace(/<Relationship\b[^>]*Type="[^"]*\/slide"[^>]*\/>/g, "");
  zip.file("ppt/_rels/presentation.xml.rels", deckRels.replace("</Relationships>", slides.map(s => `<Relationship Id="rIdDeckSlide${s.number}" Type="${R_NS}/slide" Target="slides/slide${s.number}.xml"/>`).join("") + "</Relationships>"));
  zip.file("[Content_Types].xml", types);
  if (zip.file("docProps/app.xml")) zip.file("docProps/app.xml", zip.file("docProps/app.xml")!.asText().replace(/<Slides>\d+<\/Slides>/, "<Slides>24</Slides>"));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
