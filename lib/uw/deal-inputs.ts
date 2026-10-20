// lib/uw/deal-inputs.ts
//
// Screening inputs for one deal: the engine's inputs filled from the deal's
// uploaded Excel model where there is one, else from the deal record and the
// comps, else defaults -- each value tagged with where it came from. Plus the
// checks against the comp range and the side-by-side with the Excel model.
// The Excel model stays the approved underwriting; this is a first pass.
// Pure: no I/O.

import { annualRent } from "./engine";
import { BANDS, bandOf, type AcreageBand, type CompRow, type LeaseComp, type SaleComp, adaptComps } from "./comp-adapter";
import { exitCapStats, percentile, selectComps, valueStats, type ExitCapStats, type ValueStats } from "./comp-stats";
import type { UwModelSnapshot } from "./model-snapshot";
import type { ByScenario, CapexItem, Tenant, UwInputs, UwResult } from "./types";

export type InputSource = "model" | "comps" | "deal" | "default" | "manual";
export interface Sourced { source: InputSource; note: string }

/** Engine inputs plus the screen's one extra switch. */
export interface DealUwInputs extends UwInputs {
  /** Net leases: tenants reimburse taxes, insurance and other opex, so the landlord carries none of it. */
  NnnRecovered: boolean;
}

/** The inputs a source label can attach to. Levers are labelled once for all three scenarios. */
export const SOURCE_KEYS = [
  "PurchPrice", "Acres", "CloseCost", "SaleCost", "Hold", "TgtUnlev", "TgtLev", "MinDSCR",
  "ExitCap", "RentGrowth", "Vacancy", "CapexOverrun", "LeaseDelay", "RenewProb",
  "NnnRecovered", "TaxSwitch", "TaxRate", "SellerTax", "Insurance", "MgmtPct", "ReservePerAcre", "OtherOpex", "ExpGrowth",
  "LevOn", "LoanLTV", "LoanRate", "AmortYrs", "IOYrs", "LoanFee", "rentRoll", "capex",
] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

// --- Comps ------------------------------------------------------------------

export interface CompRange {
  n: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  /** "band" = the subject's acreage band; "market" = the whole market (band too thin). */
  basis: "band" | "market";
  band: AcreageBand | null;
  /** Rent only: the subject is far bigger than any comp. */
  reference?: string;
  compIds: string[];
}

/** What the screen knows from comps, small enough to send to the browser and to snapshot with a run. */
export interface CompContext {
  market: string | null;
  asOf: string;
  months: 24 | 36;
  /** Rent per acre per month for the subject's size. */
  rent: CompRange | null;
  /** Price per acre for the subject's size. */
  sale: CompRange | null;
  /** Rent per acre per month by band, for checking each tenant. */
  rentByBand: Partial<Record<AcreageBand, CompRange>>;
  exitCap: ExitCapStats;
  /** Stated annual escalations on usable lease comps, as fractions. */
  escalation: { n: number; p25: number; median: number; p75: number } | null;
  tiers: { lease: { confirmed: number; screened: number; verified: number }; sale: { confirmed: number; screened: number; verified: number } };
  messages: string[];
}

function range(s: ValueStats): CompRange | null {
  if (s.status !== "ok") return null;
  const w = s.withExtreme;
  return { n: w.n, min: w.min, p25: w.p25, median: w.median, p75: w.p75, max: w.max, basis: s.basis, band: s.subjectBand, ...(s.reference ? { reference: s.reference } : {}), compIds: w.compIds };
}

export function compContext(rows: readonly CompRow[], market: string | null, acres: number | null, asOf: string, months: 24 | 36 = 36): CompContext {
  const empty = { confirmed: 0, screened: 0, verified: 0 };
  if (!market) {
    return { market, asOf, months, rent: null, sale: null, rentByBand: {}, exitCap: { source: "manual", n: 0, message: "No market on the deal, so no comps." }, escalation: null, tiers: { lease: empty, sale: empty }, messages: ["No market on the deal, so no comp-driven inputs."] };
  }
  const comps = adaptComps(rows);
  const leases = selectComps(comps.filter((c): c is LeaseComp => c.compType === "lease"), "lease", { market, asOf, months });
  const sales = selectComps(comps.filter((c): c is SaleComp => c.compType === "sale"), "sale", { market, asOf, months });
  const rentStats = valueStats(leases.usable, "lease", acres);
  const saleStats = valueStats(sales.usable, "sale", acres);
  const rentByBand: CompContext["rentByBand"] = {};
  for (const b of BANDS) {
    const mid = { "<3": 1.5, "3-10": 5, "10-25": 15, "25+": 30 }[b];
    const r = range(valueStats(leases.usable, "lease", mid));
    if (r) rentByBand[b] = r;
  }
  const esc = leases.usable.map((c) => c.escalation).filter((e): e is number => e !== null && e > 0 && e < 0.1);
  const messages = [
    ...(rentStats.status === "ok" ? rentStats.warnings : [rentStats.message]),
    ...(saleStats.status === "ok" ? saleStats.warnings : [saleStats.message]),
  ];
  return {
    market,
    asOf,
    months,
    rent: range(rentStats),
    sale: range(saleStats),
    rentByBand,
    exitCap: exitCapStats(sales.usable),
    escalation: esc.length >= 5 ? { n: esc.length, p25: percentile(esc, 0.25)!, median: percentile(esc, 0.5)!, p75: percentile(esc, 0.75)! } : null,
    tiers: { lease: leases.tiers, sale: sales.tiers },
    messages: [...new Set(messages)],
  };
}

// --- Defaults ---------------------------------------------------------------

/** Effective property tax as a share of value, when nothing better is known. */
export const TAX_RATE_BY_STATE: Record<string, number> = { TX: 0.022, GA: 0.015 };
export const DEFAULTS = {
  CloseCost: 0.015,
  SaleCost: 0.02,
  Hold: 5,
  TgtUnlev: 0.1,
  TgtLev: 0.15,
  MinDSCR: 1.25,
  RentGrowth: 0.03,
  Vacancy: 0.03,
  ExitCap: 0.07,
  TaxRate: 0.02,
  InsurancePerAcre: 250,
  MgmtPct: 0.02,
  ReservePerAcre: 250,
  ExpGrowth: 0.03,
  LoanLTV: 0.6,
  LoanRate: 0.0675,
  AmortYrs: 30,
  IOYrs: 2,
  LoanFee: 0.01,
  LeaseUpMonths: 6,
  RenewProb: [0.7, 0.8, 0.5] as ByScenario<number>,
  DowntimeMonths: 6,
} as const;

/** Workbook pattern: upside +1% growth, downside -1.5% (never below 0). */
const growthLevers = (g: number): ByScenario<number> => [g, g + 0.01, Math.max(0, g - 0.015)];
/** Upside 2 points better (never below 0), downside 5 points worse. */
const vacancyLevers = (v: number): ByScenario<number> => [v, Math.max(0, v - 0.02), v + 0.05];
/** Workbook pattern: upside 50 bp tighter, downside 75 bp wider. */
const capLevers = (c: number): ByScenario<number> => [c, Math.max(0.01, c - 0.005), c + 0.0075];

// --- Building the inputs ----------------------------------------------------

export interface DealFacts {
  property: string;
  market: string | null;
  state: string | null;
  acres: number | null;
  occupancy: "vacant" | "occupied" | null;
  /** The deal's own price, and what it is (closed, contract, last offer, asking). */
  price: number | null;
  priceLabel: string;
  /** The deal's in-place rent, annualised. */
  inPlaceRentAnnual: number | null;
  /** Fraction; set on the Financials tab. */
  exitCap: number | null;
  /** ISO date the screen is run. */
  today: string;
}

export interface DealUwBuild {
  inputs: DealUwInputs;
  sources: Record<SourceKey, Sourced>;
  rentRollSource: "model" | "in-place" | "lease-up";
  /** Things a person should look at before trusting the numbers. */
  warnings: string[];
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma) + (db - da) / 30.4375;
}
const wholeMonths = (v: number | null | undefined, max = 60) => (v === null || v === undefined || !Number.isFinite(v) ? 0 : Math.min(max, Math.max(0, Math.round(v))));
const pctLabel = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

const ALL: ByScenario<number> = [1, 1, 1];

function tenantsFromModel(model: UwModelSnapshot, acres: number | null): Tenant[] {
  const acq = model.acquisition;
  const termYears = model.leasing.termYears && model.leasing.termYears > 0 ? model.leasing.termYears : 5;
  return model.rentRoll
    .filter((r) => r.rentAnnual !== null && r.rentAnnual > 0)
    .map((r) => {
      const startMonth = acq && r.start ? Math.max(0, Math.round(monthsBetween(acq, r.start))) : 0;
      let end: number | null = r.remainingMonths !== null ? Math.round(r.remainingMonths) : acq && r.expiration ? Math.round(monthsBetween(acq, r.expiration) + 1 / 30.4375) : null;
      if (end !== null && end <= 0) end = null; // expired before closing: month to month
      const market = r.marketAnnual && r.marketAnnual > 0 ? r.marketAnnual : null;
      const lcBase = (market ?? r.rentAnnual!) * termYears;
      return {
        name: r.tenant,
        status: startMonth > 0 ? "Pipeline" : "In-place",
        acres: acres && r.pctSf ? Math.round(acres * r.pctSf * 100) / 100 : null,
        rent: r.rentAnnual!,
        rentPeriod: "Annual",
        bump: model.statedBump,
        startMonth,
        leaseEndMonth: end,
        retention: r.renewalPct,
        renewalProbOverride: r.renewalPct,
        renewalRent: market,
        newDealRent: market,
        newDealDowntimeMonths: wholeMonths(r.downtimeMonths),
        newDealFreeRentMonths: wholeMonths(model.leasing.freeRentMonths),
        renewalTI: model.leasing.tiRenew ?? 0,
        renewalLC: Math.round((model.leasing.lcRenewPct ?? 0) * lcBase),
        newDealTI: model.leasing.tiNew ?? 0,
        newDealLC: Math.round((model.leasing.lcNewPct ?? 0) * lcBase),
        include: ALL,
      } satisfies Tenant;
    });
}

/** A rent per acre per month for the whole site, from the comps for its size. */
const compMonthlyRent = (comps: CompContext, acres: number | null) =>
  comps.rent?.median && acres ? Math.round(comps.rent.median * acres) : null;

export function buildDealInputs(facts: DealFacts, model: UwModelSnapshot | null, comps: CompContext): DealUwBuild {
  const warnings: string[] = [];
  const src = {} as Record<SourceKey, Sourced>;
  const set = <T>(key: SourceKey, value: T, source: InputSource, note: string): T => {
    src[key] = { source, note };
    return value;
  };

  const acres = facts.acres;
  const Acres = acres && acres > 0 ? set("Acres", acres, "deal", "Lot SF / 43,560") : set("Acres", 1, "default", "No lot size on the deal; enter acres");
  if (!(acres && acres > 0)) warnings.push("The deal has no lot size; acres default to 1 and every per-acre figure is wrong until it is entered.");

  // Price: the model's, else the deal's, else comps x acres.
  let PurchPrice: number;
  if (model?.purchasePrice) PurchPrice = set("PurchPrice", model.purchasePrice, "model", `Excel model (${model.fileName})`);
  else if (facts.price) PurchPrice = set("PurchPrice", facts.price, "deal", facts.priceLabel);
  else if (comps.sale?.median && acres) PurchPrice = set("PurchPrice", Math.round(comps.sale.median * acres), "comps", `Median sale comp ${usd(comps.sale.median)}/ac x ${acres.toFixed(2)} ac (n ${comps.sale.n})`);
  else {
    PurchPrice = set("PurchPrice", 0, "default", "No price on the deal; enter one");
    warnings.push("No price on the deal or in a model, and too few sale comps to suggest one: enter a price.");
  }

  // Rent roll: the model's, else the in-place rent, else one lease-up tenant at comp rent.
  let rentRoll: Tenant[] = [];
  let rentRollSource: DealUwBuild["rentRollSource"];
  const modelTenants = model ? tenantsFromModel(model, acres) : [];
  if (modelTenants.length) {
    rentRoll = modelTenants;
    rentRollSource = "model";
    set("rentRoll", null, "model", `Rent roll from the Excel model: ${modelTenants.length} tenant${modelTenants.length === 1 ? "" : "s"}, renewal % / downtime / market rent / TI / LC as modelled`);
  } else if (facts.occupancy !== "vacant" && facts.inPlaceRentAnnual && facts.inPlaceRentAnnual > 0) {
    rentRoll = [{
      name: "In-place tenant(s)", status: "In-place", acres, rent: Math.round(facts.inPlaceRentAnnual / 12), rentPeriod: "Monthly", bump: null,
      startMonth: 0, leaseEndMonth: null, retention: null, renewalProbOverride: null,
      renewalRent: null, newDealRent: compMonthlyRent(comps, acres), newDealDowntimeMonths: DEFAULTS.DowntimeMonths, newDealFreeRentMonths: 0, include: ALL,
    }];
    rentRollSource = "in-place";
    set("rentRoll", null, "deal", "The deal's in-place rent; lease end unknown, so modelled with no expiry -- add an expiry month to test rollover");
    warnings.push("Rent roll is the deal's in-place rent with no lease end: rollover risk isn't tested until an expiry is entered.");
  } else {
    const rent = compMonthlyRent(comps, acres);
    rentRoll = [{
      name: "Lease-up at market rent", status: "Pipeline", acres, rent: rent ?? 0, rentPeriod: "Monthly", bump: null,
      startMonth: DEFAULTS.LeaseUpMonths, leaseEndMonth: null, retention: null, renewalProbOverride: null,
      renewalRent: null, newDealRent: null, newDealDowntimeMonths: 0, newDealFreeRentMonths: 0, include: ALL,
    }];
    rentRollSource = "lease-up";
    if (rent) {
      set("rentRoll", null, "comps", `${facts.occupancy === "vacant" ? "Vacant" : "No in-place rent"}: one tenant at the median comp rent ${usd(comps.rent!.median!)}/ac/mo (n ${comps.rent!.n}${comps.rent!.basis === "band" ? `, ${comps.rent!.band} ac band` : ", whole market"}), starting month ${DEFAULTS.LeaseUpMonths}`);
      if (comps.rent!.reference) warnings.push(`Lease-up rent is a ${comps.rent!.reference}: the comps are much smaller lots.`);
    } else {
      set("rentRoll", null, "default", "No in-place rent and too few lease comps: enter the rent");
      warnings.push("No rent: the deal has no in-place rent and the market has too few lease comps. Enter a rent on the rent roll.");
    }
  }

  // Capex: the model's capex costs by year.
  const capex: CapexItem[] = [];
  if (model) {
    model.capexByYear.forEach((amt, y) => {
      if (amt > 0) capex.push({ name: `Capex (model, Yr ${Math.max(1, y)})`, unitCost: Math.round(amt), units: 1, year: Math.min(10, Math.max(1, y)), include: ALL });
    });
  }
  set("capex", null, model ? "model" : "default", model ? (capex.length ? "Capex costs by year from the Excel model's cash flow" : "The Excel model has no capex costs") : "No capex: add items");

  // Levers.
  let exitCap: number;
  if (facts.exitCap) exitCap = set("ExitCap", facts.exitCap, "deal", "Exit cap set on the Financials tab");
  else if (model?.exitCap) exitCap = set("ExitCap", model.exitCap, "model", "Excel model exit cap");
  else if (comps.exitCap.source === "comps") exitCap = set("ExitCap", comps.exitCap.base, "comps", `Median sale-comp cap rate (n ${comps.exitCap.n})`);
  else {
    exitCap = set("ExitCap", DEFAULTS.ExitCap, "default", "Placeholder: enter an exit cap");
    warnings.push(`Exit cap is a ${pctLabel(DEFAULTS.ExitCap, 2)} placeholder. ${comps.exitCap.source === "manual" ? comps.exitCap.message : ""}`.trim());
  }
  src.ExitCap.note += "; upside -50 bp, downside +75 bp";

  let growth: number;
  if (comps.escalation) growth = set("RentGrowth", Math.round(comps.escalation.median * 10000) / 10000, "comps", `Median stated escalation on lease comps (n ${comps.escalation.n})`);
  else growth = set("RentGrowth", DEFAULTS.RentGrowth, "default", "Default; too few lease comps with an escalation");
  src.RentGrowth.note += "; upside +1%, downside -1.5%. Applies to tenants with no stated bump";

  let vacancy: number;
  if (model?.vacancyPct !== null && model?.vacancyPct !== undefined) vacancy = set("Vacancy", Math.round(model.vacancyPct * 1000) / 1000, "model", "Excel model Yr-1 vacancy & credit loss / potential rent");
  else vacancy = set("Vacancy", DEFAULTS.Vacancy, "default", "General vacancy & credit loss");
  src.Vacancy.note += "; on top of modelled downtime";

  const levers = {
    RentGrowth: growthLevers(growth),
    Vacancy: vacancyLevers(vacancy),
    ExitCap: capLevers(exitCap),
    CapexOverrun: set("CapexOverrun", [0, 0, 0.15] as ByScenario<number>, "default", "Downside adds 15% to capex"),
    LeaseDelay: set("LeaseDelay", [0, 0, 6] as ByScenario<number>, "default", "Downside pushes pipeline tenants out 6 months"),
    RenewProb: set("RenewProb", DEFAULTS.RenewProb, "default", "Used where a tenant has no renewal % of its own"),
  };

  const closing = model?.closingCosts && model.purchasePrice ? model.closingCosts / model.purchasePrice : null;
  const CloseCost = closing !== null
    ? set("CloseCost", Math.round(closing * 10000) / 10000, "model", "Excel model acquisition / financing costs and broker fee, on price")
    : set("CloseCost", DEFAULTS.CloseCost, "default", "Default");
  const hold = model?.holdYears && Number.isInteger(model.holdYears) && model.holdYears >= 1 && model.holdYears <= 10 ? model.holdYears : null;
  const Hold = hold ? set("Hold", hold, "model", "Excel model hold") : set("Hold", DEFAULTS.Hold, "default", "Default hold");

  const taxRate = facts.state ? TAX_RATE_BY_STATE[facts.state] : undefined;
  const reserves = model?.reservesYear1 && acres ? Math.round(model.reservesYear1 / acres) : null;

  const d = model?.debt;
  const rate = d?.rate && d.rate > 0 && d.rate < 0.2 ? d.rate : null;
  const io = d?.ioMonths !== null && d?.ioMonths !== undefined ? Math.round(d.ioMonths / 12) : null;
  const amort = d?.amortMonths ? Math.max(1, Math.round(d.amortMonths / 12)) : null;

  const inputs: DealUwInputs = {
    property: facts.property,
    scenario: "Base",
    levers,
    RollMethod: 2,
    Acres,
    PurchPrice,
    CompPerAcre: comps.sale?.median ?? (acres && PurchPrice ? PurchPrice / acres : 0),
    CloseCost,
    SaleCost: set("SaleCost", DEFAULTS.SaleCost, "default", "Default"),
    Hold,
    TgtUnlev: set("TgtUnlev", DEFAULTS.TgtUnlev, "default", "Target unlevered IRR for the solved price"),
    TgtLev: set("TgtLev", DEFAULTS.TgtLev, "default", "Target levered IRR"),
    MinDSCR: set("MinDSCR", DEFAULTS.MinDSCR, "default", "DSCR floor"),
    StepG: 0.01,
    StepCap: 0.005,
    NnnRecovered: set("NnnRecovered", true, rentRollSource === "model" ? "model" : "default", rentRollSource === "model" ? "The Excel model's leases are net" : "IOS leases assumed NNN; switch off if the landlord pays taxes and insurance"),
    TaxSwitch: set("TaxSwitch", 1 as const, "default", "Reassessed at the purchase price"),
    TaxRate: taxRate ? set("TaxRate", taxRate, "default", `Typical effective rate, ${facts.state}`) : set("TaxRate", DEFAULTS.TaxRate, "default", "Typical effective rate"),
    SellerTax: set("SellerTax", 0, "default", "Seller's current tax unknown; used only if reassessment is off"),
    Insurance: set("Insurance", Math.round(DEFAULTS.InsurancePerAcre * Acres), "default", `${usd(DEFAULTS.InsurancePerAcre)}/ac`),
    MgmtPct: set("MgmtPct", DEFAULTS.MgmtPct, "default", "Management fee on collected revenue, not recovered"),
    ReservePerAcre: reserves ? set("ReservePerAcre", reserves, "model", "Excel model Yr-1 capex reserves / acres") : set("ReservePerAcre", DEFAULTS.ReservePerAcre, "default", "Default reserves"),
    OtherOpex: set("OtherOpex", 0, "default", "None"),
    ExpGrowth: set("ExpGrowth", DEFAULTS.ExpGrowth, "default", "Default"),
    LevOn: set("LevOn", 1 as const, "default", "Levered"),
    LoanLTV: d?.ltpp ? set("LoanLTV", d.ltpp, "model", "Excel model loan to purchase price") : set("LoanLTV", DEFAULTS.LoanLTV, "default", "Default"),
    LoanRate: rate ? set("LoanRate", Math.round(rate * 100000) / 100000, "model", "Excel model index + spread") : set("LoanRate", DEFAULTS.LoanRate, "default", "Default"),
    AmortYrs: amort ? set("AmortYrs", amort, "model", "Excel model amortization") : set("AmortYrs", DEFAULTS.AmortYrs, "default", "Default"),
    IOYrs: io !== null ? set("IOYrs", io, "model", "Excel model interest-only period") : set("IOYrs", DEFAULTS.IOYrs, "default", "Default"),
    LoanFee: closing !== null ? set("LoanFee", 0, "model", "Financing costs are in the model's closing costs") : set("LoanFee", DEFAULTS.LoanFee, "default", "Default"),
    rentRoll,
    capex,
  };

  return { inputs, sources: src, rentRollSource, warnings };
}

/** What the engine runs: with NNN recovery, the landlord carries no taxes, insurance or other opex. */
export function engineInputs(d: DealUwInputs): UwInputs {
  return d.NnnRecovered ? { ...d, SellerTax: 0, Insurance: 0, OtherOpex: 0, TaxRate: 0 } : d;
}

// --- Checks against the comps ------------------------------------------------

export interface RangeCheck {
  key: SourceKey | `tenant:${number}`;
  message: string;
}

const inBand = (v: number, r: CompRange) => r.p25 !== null && r.p75 !== null && v >= r.p25 && v <= r.p75;
const bandText = (r: CompRange, fmt: (v: number) => string) =>
  `comps ${fmt(r.p25!)}-${fmt(r.p75!)} middle half, median ${fmt(r.median!)} (n ${r.n}${r.basis === "band" ? `, ${r.band} ac band` : ", whole market"})`;

/**
 * Values outside the middle half (25th-75th percentile) of the comps they
 * can be compared with: price per acre, each tenant's rents per acre, and
 * rent growth against stated escalations.
 */
export function checkAgainstComps(inputs: DealUwInputs, comps: CompContext): RangeCheck[] {
  const out: RangeCheck[] = [];
  const perAc = (v: number) => `${usd(v)}/ac`;
  if (comps.sale && inputs.Acres > 0 && inputs.PurchPrice > 0) {
    const v = inputs.PurchPrice / inputs.Acres;
    if (!inBand(v, comps.sale)) out.push({ key: "PurchPrice", message: `Price ${perAc(v)} is ${v < comps.sale.p25! ? "below" : "above"} the ${bandText(comps.sale, perAc)}.` });
  }
  const perAcMo = (v: number) => `${usd(v)}/ac/mo`;
  inputs.rentRoll.forEach((t, i) => {
    const band = bandOf(t.acres);
    const r = band ? comps.rentByBand[band] : undefined;
    if (!t.acres || !r) return;
    const monthly = (v: number | null | undefined) => (v === null || v === undefined ? null : t.rentPeriod === "Annual" ? v / 12 : v);
    const checks: Array<[string, number | null]> = [
      ["rent", annualRent(t) / 12],
      ["market / new-deal rent", monthly(t.newDealRent)],
    ];
    for (const [what, m] of checks) {
      if (m === null || !(m > 0)) continue;
      const v = m / t.acres;
      if (!inBand(v, r)) out.push({ key: `tenant:${i}`, message: `${t.name}: ${what} ${perAcMo(v)} is ${v < r.p25! ? "below" : "above"} the ${bandText(r, perAcMo)}.` });
    }
  });
  const g = inputs.levers.RentGrowth[0];
  if (comps.escalation && (g < comps.escalation.p25 || g > comps.escalation.p75)) {
    out.push({ key: "RentGrowth", message: `Rent growth ${pctLabel(g)} is outside the ${pctLabel(comps.escalation.p25)}-${pctLabel(comps.escalation.p75)} middle half of stated comp escalations (n ${comps.escalation.n}).` });
  }
  return out;
}

/**
 * The exit is priced on the NOI of the year after the sale. A lease that ends
 * within a year either side of the sale puts its expected downtime and
 * renewal mix into that NOI, which lowers the exit value -- a model that sells
 * on stabilized NOI will show a higher return.
 */
export function exitRolloverWarnings(inputs: UwInputs): string[] {
  const H = inputs.Hold;
  return inputs.rentRoll
    .filter((t) => t.leaseEndMonth !== null && t.leaseEndMonth > 12 * (H - 1) && t.leaseEndMonth <= 12 * (H + 1))
    .map(
      (t) =>
        `${t.name}'s lease ends in month ${t.leaseEndMonth}, around the Year-${H} sale: the exit is priced on Year-${H + 1} NOI with its expected downtime and renewal odds, not on stabilized rent.`
    );
}

// --- Side by side with the Excel model ---------------------------------------

export interface CompareRow {
  label: string;
  hopper: number | null;
  model: number | null;
  format: "usd" | "pct" | "ratio" | "years";
}

export function compareWithModel(result: UwResult, inputs: UwInputs, model: UwModelSnapshot): CompareRow[] {
  const r = result.returns;
  return [
    { label: "Purchase price", hopper: inputs.PurchPrice, model: model.purchasePrice, format: "usd" },
    { label: "Hold", hopper: inputs.Hold, model: model.holdYears, format: "years" },
    { label: "Exit cap", hopper: result.active.ExitCap, model: model.exitCap, format: "pct" },
    { label: "Yr-1 NOI", hopper: r.year1Noi, model: model.year1Noi, format: "usd" },
    { label: "Going-in cap", hopper: r.goingInCap, model: model.goingInCap, format: "pct" },
    { label: "Unlevered IRR", hopper: r.unleveredIrr, model: model.unleveredIrr, format: "pct" },
    { label: "Unlevered multiple", hopper: r.unleveredMultiple, model: model.unleveredMultiple, format: "ratio" },
    { label: "Levered IRR", hopper: r.leveredIrr, model: model.leveredIrr, format: "pct" },
    { label: "Levered multiple", hopper: r.leveredMultiple, model: model.leveredMultiple, format: "ratio" },
  ];
}

// --- Saved runs ---------------------------------------------------------------

export const SCREEN_VERSION = "uw-screen-v1";
export const MAX_TENANTS = 40;
export const MAX_CAPEX = 30;

const finite = (v: unknown, lo = -Infinity, hi = Infinity): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const triple = (v: unknown, lo: number, hi: number): v is ByScenario<number> => Array.isArray(v) && v.length === 3 && v.every((x) => finite(x, lo, hi));
const optFinite = (v: unknown, lo: number, hi: number) => v === undefined || v === null || finite(v, lo, hi);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/**
 * Screening inputs sent from the browser, checked field by field before the
 * server runs and saves them. Returns the inputs rebuilt from known fields
 * only, or a message naming the first bad field.
 */
export function sanitizeInputs(x: any): DealUwInputs | string {
  if (!x || typeof x !== "object") return "inputs missing";
  const lv = x.levers ?? {};
  const checks: Array<[string, boolean]> = [
    ["property", text(x.property, 200)],
    ["scenario", ["Base", "Upside", "Downside"].includes(x.scenario)],
    ["RentGrowth", triple(lv.RentGrowth, -0.2, 0.3)],
    ["Vacancy", triple(lv.Vacancy, 0, 1)],
    ["ExitCap", triple(lv.ExitCap, 0.001, 0.5)],
    ["CapexOverrun", triple(lv.CapexOverrun, 0, 5)],
    ["LeaseDelay", triple(lv.LeaseDelay, 0, 120)],
    ["RenewProb", lv.RenewProb === undefined || triple(lv.RenewProb, 0, 1)],
    ["RollMethod", x.RollMethod === 1 || x.RollMethod === 2],
    ["Acres", finite(x.Acres, 0.01, 100000)],
    ["PurchPrice", finite(x.PurchPrice, 0, 1e10)],
    ["CompPerAcre", finite(x.CompPerAcre, 0, 1e9)],
    ["CloseCost", finite(x.CloseCost, 0, 0.5)],
    ["SaleCost", finite(x.SaleCost, 0, 0.5)],
    ["Hold", Number.isInteger(x.Hold) && x.Hold >= 1 && x.Hold <= 10],
    ["TgtUnlev", finite(x.TgtUnlev, -0.5, 1)],
    ["TgtLev", finite(x.TgtLev, -0.5, 2)],
    ["MinDSCR", finite(x.MinDSCR, 0, 10)],
    ["StepG", finite(x.StepG, 0, 0.1)],
    ["StepCap", finite(x.StepCap, 0, 0.05)],
    ["NnnRecovered", typeof x.NnnRecovered === "boolean"],
    ["SellerTax", finite(x.SellerTax, 0, 1e8)],
    ["Insurance", finite(x.Insurance, 0, 1e8)],
    ["TaxSwitch", x.TaxSwitch === 0 || x.TaxSwitch === 1],
    ["TaxRate", finite(x.TaxRate, 0, 0.2)],
    ["MgmtPct", finite(x.MgmtPct, 0, 0.5)],
    ["ReservePerAcre", finite(x.ReservePerAcre, 0, 1e6)],
    ["OtherOpex", finite(x.OtherOpex, 0, 1e8)],
    ["ExpGrowth", finite(x.ExpGrowth, -0.2, 0.3)],
    ["LevOn", x.LevOn === 0 || x.LevOn === 1],
    ["LoanLTV", finite(x.LoanLTV, 0, 1)],
    ["LoanRate", finite(x.LoanRate, 0, 0.5)],
    ["AmortYrs", Number.isInteger(x.AmortYrs) && x.AmortYrs >= 1 && x.AmortYrs <= 40],
    ["IOYrs", Number.isInteger(x.IOYrs) && x.IOYrs >= 0 && x.IOYrs <= 40],
    ["LoanFee", finite(x.LoanFee, 0, 0.2)],
    ["rentRoll", Array.isArray(x.rentRoll) && x.rentRoll.length <= MAX_TENANTS],
    ["capex", Array.isArray(x.capex) && x.capex.length <= MAX_CAPEX],
  ];
  const bad = checks.find(([, ok]) => !ok);
  if (bad) return `bad input: ${bad[0]}`;
  const rentRoll: Tenant[] = [];
  for (const [i, t] of (x.rentRoll as any[]).entries()) {
    const months = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 60);
    const ok =
      t && text(t.name, 200) && ["In-place", "Pipeline"].includes(t.status) && optFinite(t.acres, 0, 100000) &&
      finite(t.rent, 0, 1e9) && ["Monthly", "Annual"].includes(t.rentPeriod) && optFinite(t.bump, -0.2, 0.3) &&
      finite(t.startMonth, 0, 240) && optFinite(t.leaseEndMonth, 0, 1200) && optFinite(t.retention, 0, 1) &&
      optFinite(t.renewalProbOverride, 0, 1) && optFinite(t.renewalRent, 0, 1e9) && optFinite(t.newDealRent, 0, 1e9) &&
      months(t.freeRentMonths) && months(t.freeRentOnRenewalMonths) && months(t.newDealDowntimeMonths) && months(t.newDealFreeRentMonths) &&
      ["renewalTI", "renewalLC", "newDealTI", "newDealLC"].every((k) => optFinite(t[k], 0, 1e9)) && triple(t.include, 0, 1);
    if (!ok) return `bad input: rent roll row ${i + 1}`;
    rentRoll.push({
      name: t.name, status: t.status, acres: t.acres ?? null, rent: t.rent, rentPeriod: t.rentPeriod, bump: t.bump ?? null,
      startMonth: t.startMonth, leaseEndMonth: t.leaseEndMonth ?? null, retention: t.retention ?? null,
      freeRentMonths: t.freeRentMonths ?? 0, freeRentOnRenewalMonths: t.freeRentOnRenewalMonths ?? 0,
      renewalProbOverride: t.renewalProbOverride ?? null, renewalRent: t.renewalRent ?? null, newDealRent: t.newDealRent ?? null,
      newDealDowntimeMonths: t.newDealDowntimeMonths ?? 0, newDealFreeRentMonths: t.newDealFreeRentMonths ?? 0,
      renewalTI: t.renewalTI ?? 0, renewalLC: t.renewalLC ?? 0, newDealTI: t.newDealTI ?? 0, newDealLC: t.newDealLC ?? 0,
      include: [t.include[0], t.include[1], t.include[2]],
    });
  }
  const capex: CapexItem[] = [];
  for (const [i, c] of (x.capex as any[]).entries()) {
    if (!c || !text(c.name, 200) || !finite(c.unitCost, 0, 1e9) || !finite(c.units, 0, 1e6) || !(Number.isInteger(c.year) && c.year >= 1 && c.year <= 10) || !triple(c.include, 0, 1)) {
      return `bad input: capex row ${i + 1}`;
    }
    capex.push({ name: c.name, unitCost: c.unitCost, units: c.units, year: c.year, include: [c.include[0], c.include[1], c.include[2]] });
  }
  const pick = <K extends keyof DealUwInputs>(...keys: K[]) => Object.fromEntries(keys.map((k) => [k, x[k]])) as Pick<DealUwInputs, K>;
  return {
    ...pick("property", "scenario", "RollMethod", "Acres", "PurchPrice", "CompPerAcre", "CloseCost", "SaleCost", "Hold", "TgtUnlev", "TgtLev", "MinDSCR",
      "StepG", "StepCap", "NnnRecovered", "SellerTax", "Insurance", "TaxSwitch", "TaxRate", "MgmtPct", "ReservePerAcre", "OtherOpex", "ExpGrowth",
      "LevOn", "LoanLTV", "LoanRate", "AmortYrs", "IOYrs", "LoanFee"),
    levers: {
      RentGrowth: [...lv.RentGrowth] as unknown as ByScenario<number>,
      Vacancy: [...lv.Vacancy] as unknown as ByScenario<number>,
      ExitCap: [...lv.ExitCap] as unknown as ByScenario<number>,
      CapexOverrun: [...lv.CapexOverrun] as unknown as ByScenario<number>,
      LeaseDelay: [...lv.LeaseDelay] as unknown as ByScenario<number>,
      ...(lv.RenewProb ? { RenewProb: [...lv.RenewProb] as unknown as ByScenario<number> } : {}),
    },
    rentRoll,
    capex,
  };
}
