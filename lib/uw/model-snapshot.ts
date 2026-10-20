// lib/uw/model-snapshot.ts
//
// The parts of an uploaded Dalfen Excel model the screening engine starts
// from, cut down from the IC deck parser's ModelSummary: rent roll, leasing
// assumptions, debt, closing costs, capex timing and the model's own returns
// (for the side-by-side). Pure; the type import is the only link to lib/ic-deck.

import type { ModelSummary } from "../ic-deck/model";

export interface ModelRentRow {
  tenant: string;
  /** Share of the property's SF (building SF in the Dalfen model). */
  pctSf: number | null;
  start: string | null;
  expiration: string | null;
  remainingMonths: number | null;
  renewalPct: number | null;
  downtimeMonths: number | null;
  /** Scheduled base rent at closing, annual. */
  rentAnnual: number | null;
  /** Market rent at closing, annual. */
  marketAnnual: number | null;
}

export interface UwModelSnapshot {
  fileName: string;
  acquisition: string | null;
  holdYears: number | null;
  purchasePrice: number | null;
  /** Acquisition / financing costs plus broker fee, in dollars. */
  closingCosts: number | null;
  exitCap: number | null;
  goingInCap: number | null;
  unleveredIrr: number | null;
  unleveredMultiple: number | null;
  leveredIrr: number | null;
  leveredMultiple: number | null;
  year1Noi: number | null;
  /** Year-1 vacancy & credit loss as a share of potential base rent. */
  vacancyPct: number | null;
  /** Year-1 capex reserves, dollars. */
  reservesYear1: number | null;
  /**
   * Year-2 over Year-1 potential base rent when every lease runs through
   * Year 2 -- the contractual bump. Null when a lease turns over first.
   */
  statedBump: number | null;
  /** "Capex Costs" by model year (index = year, 0 = closing), positive dollars. */
  capexByYear: number[];
  debt: { ltpp: number | null; rate: number | null; ioMonths: number | null; amortMonths: number | null };
  leasing: { termYears: number | null; freeRentMonths: number | null; tiNew: number | null; tiRenew: number | null; lcNewPct: number | null; lcRenewPct: number | null };
  rentRoll: ModelRentRow[];
}

const money = (s: string | undefined) => {
  const m = /-?\$?\s*([\d,]+(?:\.\d+)?)/.exec(s ?? "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
const percent = (s: string | undefined) => {
  const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(s ?? "");
  return m ? Number(m[1]) / 100 : null;
};
const plain = (s: string | undefined) => {
  const m = /(-?\d+(?:\.\d+)?)/.exec(s ?? "");
  return m ? Number(m[1]) : null;
};

export function modelSnapshot(m: ModelSummary): UwModelSnapshot {
  const lease = (re: RegExp) => m.leasing.find((l) => re.test(l.label))?.value;
  const capLine = (re: RegExp) => m.capitalization.filter((c) => re.test(c.label)).reduce((s, c) => s + (c.amount ?? 0), 0);
  const row = (re: RegExp) => m.cashFlow.rows.find((r) => re.test(r.label));
  const yr1 = (re: RegExp) => row(re)?.values[1] ?? null;
  const price = m.capitalization.find((c) => /^price$/i.test(c.label))?.amount ?? null;
  const potential = yr1(/^Potential Base Rent$/i);
  const vacancy = yr1(/^Total Vacancy & Credit Loss$/i);
  const reserves = yr1(/^Capex Reserves$/i);
  const closing = capLine(/acquisition|financing|broker/i);
  const capex = row(/^Capex Costs$/i)?.values ?? [];
  const pbr = row(/^Potential Base Rent$/i)?.values ?? [];
  const throughYear2 = m.rentRoll.rows.length > 0 && m.rentRoll.rows.every((r) => r.remainingMonths !== null && r.remainingMonths >= 24);
  const bump = throughYear2 && pbr[1] && pbr[2] ? pbr[2] / pbr[1] - 1 : null;
  const debt = m.debt;
  return {
    fileName: m.source.fileName,
    acquisition: m.dates.acquisition,
    holdYears: m.returns.holdYears,
    purchasePrice: price,
    closingCosts: closing > 0 ? closing : null,
    exitCap: m.yields.exitCap,
    goingInCap: m.yields.goingIn,
    unleveredIrr: m.returns.unlevered.irr,
    unleveredMultiple: m.returns.unlevered.multiple,
    leveredIrr: m.returns.levered.irr,
    leveredMultiple: m.returns.levered.multiple,
    year1Noi: yr1(/^NOI$/i),
    vacancyPct: potential && vacancy !== null ? Math.abs(vacancy) / potential : null,
    reservesYear1: reserves === null ? null : Math.abs(reserves),
    statedBump: bump !== null && bump >= 0 && bump <= 0.1 ? Math.round(bump * 10000) / 10000 : null,
    capexByYear: capex.map((v) => (v ? Math.abs(v) : 0)),
    debt: {
      ltpp: debt.ltpp,
      rate: debt.index !== null && debt.spread !== null ? debt.index + debt.spread : null,
      ioMonths: debt.interestOnlyMonths,
      amortMonths: debt.amortizationMonths,
    },
    leasing: {
      termYears: plain(lease(/^Term Length/i)),
      freeRentMonths: plain(lease(/^Free Rent/i)),
      tiNew: money(lease(/^Tenant Improvements \(New\)/i)),
      tiRenew: money(lease(/^Tenant Improvements \(Renew\)/i)),
      lcNewPct: percent(lease(/^Leasing Commissions \(New\)/i)),
      lcRenewPct: percent(lease(/^Leasing Commissions \(Renew\)/i)),
    },
    rentRoll: m.rentRoll.rows.map((r) => ({
      tenant: r.tenant,
      pctSf: r.pctSf,
      start: r.start,
      expiration: r.expiration,
      remainingMonths: r.remainingMonths,
      renewalPct: r.renewalPct,
      downtimeMonths: r.downtimeMonths,
      rentAnnual: r.sbrAnnual,
      marketAnnual: r.marketAnnual,
    })),
  };
}

/**
 * uw_versions.model_detail for a parsed model: the sensitivity tables for
 * the Financials tab (when the model has them) and the snapshot the
 * Underwriting tab starts from.
 */
export function modelDetailOf(m: ModelSummary): Record<string, unknown> {
  return {
    ...(m.sensitivities.deal || m.sensitivities.lp
      ? { sensitivities: m.sensitivities, exitCap: m.yields.exitCap, warnings: m.warnings.filter((w) => /sensitivity/i.test(w)) }
      : {}),
    uw: modelSnapshot(m),
  };
}
