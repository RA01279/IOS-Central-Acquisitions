// lib/uw/engine.ts
//
// A faithful port of fixtures/Rendon_Rd_IOS_DCF.xlsx -- a multi-tenant IOS
// annual DCF. Pure functions only: no I/O, no Next, no database.
//
// Each function is named for the workbook row or cell it reproduces, and keeps
// the workbook's defined names (Hold, ExitCap, RentGrowth, TaxSwitch...), so a
// number can be traced from here to the cell it came from. Where the workbook
// does something questionable it is reproduced, not fixed, and noted -- except
// the four Phase 1b corrections (capex include from tenants, straight-line
// principal at a 0% rate, yield on cost in year MIN(2, Hold), capexAfterExit),
// which follow the corrected workbook.
//
// Years run 0..11 (CashFlow!C:N). Year 0 is closing; year 11 exists only to
// supply forward NOI for a year-10 exit.

import { irr } from "./irr";
import {
  SCENARIOS,
  type CapexItem,
  type CashFlowTable,
  type Returns,
  type ScenarioName,
  type SensitivityGrid,
  type Tenant,
  type UwInputs,
  type UwResult,
} from "./types";

export const LAST_YEAR = 11;
const YEARS = Array.from({ length: LAST_YEAR + 1 }, (_, t) => t);
/** The workbook's stand-in for "no lease end" (IF(K="",99999,K)). */
const NO_EXPIRY = 99999;

const zeros = () => YEARS.map(() => 0);
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** Inputs!B12 = MATCH(scenario, B4:D4, 0). */
export function ScenIdx(scenario: ScenarioName): 1 | 2 | 3 {
  const i = SCENARIOS.indexOf(scenario);
  if (i < 0) throw new Error(`Unknown scenario "${scenario}"`);
  return (i + 1) as 1 | 2 | 3;
}

/** Inputs!E5:E9 = INDEX(B:D, ScenIdx). */
export function activeLevers(inputs: UwInputs) {
  const i = ScenIdx(inputs.scenario) - 1;
  const l = inputs.levers;
  return {
    RentGrowth: l.RentGrowth[i],
    Vacancy: l.Vacancy[i],
    ExitCap: l.ExitCap[i],
    CapexOverrun: l.CapexOverrun[i],
    LeaseDelay: l.LeaseDelay[i],
  };
}

// --- RentRoll ---------------------------------------------------------------

/** RentRoll!H = IF(G="Annual", F, F*12). */
export function annualRent(t: Tenant): number {
  return t.rentPeriod === "Annual" ? t.rent : t.rent * 12;
}

/** RentRoll!P = INDEX(M:O, ScenIdx). */
export function activeIncl(t: Tenant, scenario: ScenarioName): number {
  return t.include[ScenIdx(scenario) - 1];
}

/**
 * RentRoll!Q = IF(I="", RentGrowth, I). The Sens tab adds a shift to the
 * market rate only (IF(I="", RentGrowth+shift, I)), so a stated bump is never
 * sensitised.
 */
export function effectiveBump(t: Tenant, RentGrowth: number, growthShift = 0): number {
  return t.bump === null ? RentGrowth + growthShift : t.bump;
}

/** RentRoll!R = J + IF(C="Pipeline", LeaseDelay, 0). */
export function effectiveStart(t: Tenant, LeaseDelay: number): number {
  return t.startMonth + (t.status === "Pipeline" ? LeaseDelay : 0);
}

/**
 * CashFlow!D9:N18 -- one tenant's revenue in year t (t >= 1), with E = lease
 * end (99999 if none) and st = effective start:
 *
 *   inlease = MAX(0, MIN(12t, E) - MAX(12(t-1), st))
 *   free0   = MAX(0, MIN(12t, st + freeRentMonths, E) - MAX(12(t-1), st))
 *   post    = MAX(0, 12t - MAX(12(t-1), E, st))
 *   free1   = MAX(0, MIN(12t, E + freeRentOnRenewalMonths) - MAX(12(t-1), E, st))
 *   revenue = H * P * (1+Q)^(t-1) * ((inlease - free0) + L * (post - free1)) / 12
 *
 * Months in lease (less free months from the start) plus retained months
 * after the lease end (less free months on renewal), counted from closing.
 * Free rent never extends past the period it belongs to, so free rent longer
 * than the lease only costs the in-lease months. Growth compounds from year 1
 * even for a tenant that starts later; free months don't change growth or
 * retention. With both free-rent fields at 0 this is the original workbook
 * formula.
 */
export function tenantRevenue(
  t: Tenant,
  year: number,
  ctx: { scenario: ScenarioName; RentGrowth: number; LeaseDelay: number; growthShift?: number }
): number {
  if (year < 1) return 0;
  const H = annualRent(t);
  const P = activeIncl(t, ctx.scenario);
  const Q = effectiveBump(t, ctx.RentGrowth, ctx.growthShift ?? 0);
  const R = effectiveStart(t, ctx.LeaseDelay);
  const end = t.leaseEndMonth ?? NO_EXPIRY;
  const L = t.retention ?? 0; // a blank cell multiplies as 0
  const yearStart = 12 * (year - 1);
  const yearEnd = 12 * year;
  const free = t.freeRentMonths ?? 0;
  const freeRenewal = t.freeRentOnRenewalMonths ?? 0;
  const inLease = Math.max(0, Math.min(yearEnd, end) - Math.max(yearStart, R));
  const freeAtStart = Math.max(0, Math.min(yearEnd, R + free, end) - Math.max(yearStart, R));
  const post = Math.max(0, yearEnd - Math.max(yearStart, end, R));
  const freeOnRenewal = Math.max(0, Math.min(yearEnd, end + freeRenewal) - Math.max(yearStart, end, R));
  const months = inLease - freeAtStart + L * (post - freeOnRenewal);
  return (H * P * (1 + Q) ** (year - 1) * months) / 12;
}

// --- Capex ------------------------------------------------------------------

/** Capex!D, resolving the RentRoll acreage link (Capex!D6 = RentRoll!E15). */
export function capexUnits(item: CapexItem, rentRoll: readonly Tenant[]): number {
  if (typeof item.units === "number") return item.units;
  const tenant = rentRoll[item.units.tenantAcres];
  if (!tenant) throw new Error(`Capex "${item.name}" links to a tenant that doesn't exist`);
  return tenant.acres ?? 0;
}

/**
 * Capex!J, the item's include % in the active scenario. Fixed flags for site
 * work (fencing, lighting); for lease-up paving, the MAX of the include % of
 * the tenants it serves (row 1: the large tenant; row 2: the Prime and
 * Straight 6 expansions).
 */
export function capexIncl(item: CapexItem, inputs: UwInputs): number {
  if (!("tenantIncl" in item.include)) return item.include[ScenIdx(inputs.scenario) - 1];
  const tenants = item.include.tenantIncl.map((i) => {
    const tenant = inputs.rentRoll[i];
    if (!tenant) throw new Error(`Capex "${item.name}" links to a tenant that doesn't exist`);
    return activeIncl(tenant, inputs.scenario);
  });
  return tenants.length ? Math.max(...tenants) : 0;
}

/** Capex!K = F * J * (1 + CapexOverrun), with F = C * D. */
export function capexScenarioCost(item: CapexItem, inputs: UwInputs, CapexOverrun: number): number {
  const gross = item.unitCost * capexUnits(item, inputs.rentRoll);
  return gross * capexIncl(item, inputs) * (1 + CapexOverrun);
}

// --- Debt -------------------------------------------------------------------

/** Excel PMT(rate, nper, pv) for type 0, as a positive payment. */
function payment(rate: number, nper: number, pv: number): number {
  return (pv * rate) / (1 - (1 + rate) ** -nper);
}

/**
 * Sum of monthly interest and principal over amortisation months
 * [startMonth, endMonth] (1-based, inclusive) -- what CUMIPMT / CUMPRINC
 * return, as positive amounts.
 */
export function cumulativeInterestPrincipal(
  monthlyRate: number,
  nper: number,
  pv: number,
  startMonth: number,
  endMonth: number
): { interest: number; principal: number } {
  const pmt = payment(monthlyRate, nper, pv);
  let balance = pv;
  let interest = 0;
  let principal = 0;
  const last = Math.min(endMonth, nper);
  for (let m = 1; m <= last; m++) {
    const i = balance * monthlyRate;
    const p = pmt - i;
    if (m >= startMonth) {
      interest += i;
      principal += p;
    }
    balance -= p;
  }
  return { interest, principal };
}

/**
 * CashFlow!D51 / D52 for one year, as negative cash flows:
 *
 *   loan <= 0           -> 0
 *   t <= IOYrs          -> interest only, loan * LoanRate
 *   t - IOYrs > AmortYrs -> 0 (fully repaid)
 *   LoanRate = 0        -> no interest; principal straight-line, loan / AmortYrs
 *   otherwise           -> CUMIPMT / CUMPRINC over that year's 12 months
 *
 * Negative rates are rejected in validate().
 */
export function debtForYear(
  year: number,
  loan: number,
  d: Pick<UwInputs, "LoanRate" | "IOYrs" | "AmortYrs">
): { interest: number; principal: number } {
  if (year < 1 || loan <= 0) return { interest: 0, principal: 0 };
  if (year <= d.IOYrs) return { interest: -loan * d.LoanRate, principal: 0 };
  const amortYear = year - d.IOYrs;
  if (amortYear > d.AmortYrs) return { interest: 0, principal: 0 };
  if (d.LoanRate === 0) return { interest: 0, principal: -loan / d.AmortYrs };
  const { interest, principal } = cumulativeInterestPrincipal(
    d.LoanRate / 12,
    d.AmortYrs * 12,
    loan,
    (amortYear - 1) * 12 + 1,
    amortYear * 12
  );
  return { interest: -interest, principal: -principal };
}

// --- Validation -------------------------------------------------------------

function validate(inputs: UwInputs): void {
  const { Hold, IOYrs, AmortYrs } = inputs;
  if (!Number.isInteger(Hold) || Hold < 1 || Hold > 10) {
    throw new Error(`Hold must be a whole number of years from 1 to 10 (got ${Hold})`);
  }
  if (!Number.isInteger(IOYrs) || IOYrs < 0) throw new Error(`IOYrs must be a whole number >= 0 (got ${IOYrs})`);
  if (!Number.isInteger(AmortYrs) || AmortYrs < 1) throw new Error(`AmortYrs must be a whole number >= 1 (got ${AmortYrs})`);
  if (!(inputs.LoanRate >= 0)) throw new Error(`LoanRate must be 0 or above (got ${inputs.LoanRate})`);
  for (const t of inputs.rentRoll) {
    for (const [field, v] of [["freeRentMonths", t.freeRentMonths], ["freeRentOnRenewalMonths", t.freeRentOnRenewalMonths]] as const) {
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > 60) {
        throw new Error(`${t.name}: ${field} must be a whole number of months from 0 to 60 (got ${v})`);
      }
    }
  }
  const { ExitCap } = activeLevers(inputs);
  if (!(ExitCap > 0)) throw new Error(`ExitCap must be above 0 (got ${ExitCap})`);
}

// --- CashFlow ---------------------------------------------------------------

export interface CashFlowOverrides {
  /** Added to RentGrowth for tenants with no stated bump (Sens blocks). */
  growthShift?: number;
  /** Replaces the active ExitCap (Sens columns). */
  ExitCap?: number;
}

/** The whole CashFlow tab for the active scenario. */
export function buildCashFlow(inputs: UwInputs, overrides: CashFlowOverrides = {}): CashFlowTable {
  validate(inputs);
  const lv = activeLevers(inputs);
  const ExitCap = overrides.ExitCap ?? lv.ExitCap;
  if (!(ExitCap > 0)) throw new Error(`ExitCap must be above 0 (got ${ExitCap})`);
  const {
    Hold, PurchPrice, CloseCost, SaleCost, TaxSwitch, TaxRate, SellerTax, Insurance,
    OtherOpex, MgmtPct, ReservePerAcre, Acres, ExpGrowth, LevOn, LoanLTV, LoanFee, TgtUnlev,
  } = inputs;
  const grow = (t: number) => (1 + ExpGrowth) ** (t - 1);
  const ops = (f: (t: number) => number) => YEARS.map((t) => (t >= 1 ? f(t) : 0));

  // Rows 4-6.
  const year = [...YEARS];
  const inHold = YEARS.map((t) => (t >= 1 && t <= Hold ? 1 : 0));
  const exitFlag = YEARS.map((t) => (t === Hold ? 1 : 0));

  // Rows 9-21.
  const ctx = { scenario: inputs.scenario, RentGrowth: lv.RentGrowth, LeaseDelay: lv.LeaseDelay, growthShift: overrides.growthShift ?? 0 };
  const tenantRev = inputs.rentRoll.map((tenant) => YEARS.map((t) => tenantRevenue(tenant, t, ctx)));
  const totalRevenue = YEARS.map((t) => sum(tenantRev.map((row) => row[t])));
  const vacancy = totalRevenue.map((r) => -r * lv.Vacancy);
  const egr = totalRevenue.map((r, t) => r + vacancy[t]);

  // Rows 24-32.
  const taxBase = TaxSwitch === 1 ? PurchPrice * TaxRate : SellerTax;
  const propertyTax = ops((t) => -taxBase * grow(t));
  const insurance = ops((t) => -Insurance * grow(t));
  const otherOpex = ops((t) => -OtherOpex * grow(t));
  const mgmtFee = ops((t) => -MgmtPct * egr[t]);
  const totalOpex = YEARS.map((t) => propertyTax[t] + insurance[t] + otherOpex[t] + mgmtFee[t]);
  const noi = YEARS.map((t) => (t >= 1 ? egr[t] + totalOpex[t] : 0));
  const noiExReassessedTax = ops((t) => noi[t] + (TaxSwitch === 1 ? PurchPrice * TaxRate * grow(t) : 0));
  const reassessedTaxPerDollar = ops((t) => TaxSwitch * TaxRate * grow(t));

  // Rows 35-36. SUMIF on the capex year; years outside 1..11 never match a column.
  const capexCosts = inputs.capex.map((item) => ({ year: item.year, cost: capexScenarioCost(item, inputs, lv.CapexOverrun) }));
  const capex = ops((t) => -sum(capexCosts.filter((c) => c.year === t).map((c) => c.cost)));
  const reserves = ops((t) => -ReservePerAcre * Acres * grow(t));

  // Rows 39-46. Forward NOI for year 11 reads the blank column O, i.e. 0.
  const noiAt = (t: number) => (t <= LAST_YEAR ? noi[t] : 0);
  const purchase = YEARS.map((t) => (t === 0 ? -PurchPrice * (1 + CloseCost) : 0));
  const noiInHold = YEARS.map((t) => noi[t] * inHold[t]);
  const capexInHold = YEARS.map((t) => (capex[t] + reserves[t]) * inHold[t]);
  const forwardNoi = ops((t) => noiAt(t + 1));
  const grossExit = ops((t) => (exitFlag[t] * forwardNoi[t]) / ExitCap);
  const saleCosts = grossExit.map((g) => -g * SaleCost);
  const netSale = grossExit.map((g, t) => g + saleCosts[t]);
  const unleveredCF = YEARS.map((t) => (t === 0 ? purchase[0] : noiInHold[t] + capexInHold[t] + netSale[t]));

  // Rows 49-56.
  const loan = LevOn * LoanLTV * PurchPrice;
  const loanProceeds = YEARS.map((t) => (t === 0 ? loan : 0));
  const loanFee = YEARS.map((t) => (t === 0 ? -loan * LoanFee : 0));
  const debt = YEARS.map((t) => debtForYear(t, loan, inputs));
  const interest = debt.map((d) => d.interest);
  const principal = debt.map((d) => d.principal);
  const debtService = YEARS.map((t) => interest[t] + principal[t]);
  const loanBalance: number[] = [];
  YEARS.forEach((t) => loanBalance.push(t === 0 ? loan : loanBalance[t - 1] + principal[t]));
  const loanPayoff = ops((t) => -exitFlag[t] * loanBalance[t]);
  const leveredCF = YEARS.map((t) =>
    t === 0 ? unleveredCF[0] + loanProceeds[0] + loanFee[0] : unleveredCF[t] + debtService[t] * inHold[t] + loanPayoff[t]
  );

  // Rows 57-58.
  const equity = -leveredCF[0];
  const cashOnCash = YEARS.map((t) =>
    t >= 1 && inHold[t] === 1 && equity > 0 ? (noiInHold[t] + capexInHold[t] + debtService[t]) / equity : null
  );
  const dscr = YEARS.map((t) => (t >= 1 && inHold[t] === 1 && debtService[t] < 0 ? noi[t] / -debtService[t] : null));

  // Rows 61-63 (price-solve helpers). Row 62/63 forward terms read year t+1.
  const discountFactor = ops((t) => 1 / (1 + TgtUnlev) ** t);
  const exAt = (t: number) => (t <= LAST_YEAR ? noiExReassessedTax[t] : 0);
  const taxAt = (t: number) => (t <= LAST_YEAR ? reassessedTaxPerDollar[t] : 0);
  const priceSolveCF = ops((t) => noiExReassessedTax[t] * inHold[t] + capexInHold[t] + (exitFlag[t] * (1 - SaleCost) * exAt(t + 1)) / ExitCap);
  const priceSolveTaxCost = ops((t) => reassessedTaxPerDollar[t] * inHold[t] + (exitFlag[t] * (1 - SaleCost) * taxAt(t + 1)) / ExitCap);

  return {
    year, inHold, exitFlag,
    tenantRevenue: tenantRev, totalRevenue, vacancy, egr,
    propertyTax, insurance, otherOpex, mgmtFee, totalOpex, noi, noiExReassessedTax, reassessedTaxPerDollar,
    capex, reserves,
    purchase, noiInHold, capexInHold, forwardNoi, grossExit, saleCosts, netSale, unleveredCF,
    loanProceeds, loanFee, interest, principal, debtService, loanBalance, loanPayoff, leveredCF,
    cashOnCash, dscr,
    discountFactor, priceSolveCF, priceSolveTaxCost,
  };
}

// --- Returns ----------------------------------------------------------------

/** CashFlow!C67/C69 = SUMIF(>0) / -SUMIF(<0). Null where the workbook would #DIV/0!. */
export function equityMultiple(cf: readonly number[]): number | null {
  const pos = sum(cf.filter((v) => v > 0));
  const neg = -sum(cf.filter((v) => v < 0));
  return neg > 0 ? pos / neg : null;
}

/**
 * CashFlow!C80, the closed-form price at the target unlevered IRR:
 *
 *   SUMPRODUCT(row62, DF) / (1 + CloseCost + SUMPRODUCT(row63, DF))
 *
 * Price P solves  P*(1+CloseCost) = sum_t DF_t * (CF_t - P * taxPerDollar_t),
 * where the reassessed tax (TaxSwitch=1) scales with the price being solved.
 */
export function solvedPrice(cf: CashFlowTable, CloseCost: number): number {
  const num = sum(cf.priceSolveCF.map((v, t) => v * cf.discountFactor[t]));
  const den = 1 + CloseCost + sum(cf.priceSolveTaxCost.map((v, t) => v * cf.discountFactor[t]));
  return num / den;
}

/** Scenario capex for items booked after the exit year (never charged to the hold). */
export function capexAfterExit(inputs: UwInputs): number {
  const { CapexOverrun } = activeLevers(inputs);
  return sum(inputs.capex.filter((item) => item.year > inputs.Hold).map((item) => capexScenarioCost(item, inputs, CapexOverrun)));
}

export function computeReturns(inputs: UwInputs, cf: CashFlowTable): Returns {
  const { PurchPrice, CloseCost, Acres, TaxRate, Hold } = inputs;
  const coc = cf.cashOnCash.filter((v): v is number => v !== null);
  const dscr = cf.dscr.filter((v): v is number => v !== null);
  // Yield on cost: NOI in year MIN(2, Hold), so a 1-year hold isn't measured
  // on a year it never owns. Cost basis is price + closing + capex (row 35)
  // scheduled inside the hold; reserves are not in it.
  const capexInHold = sum(cf.capex.map((v, t) => v * cf.inHold[t]));
  const costBasis = PurchPrice * (1 + CloseCost) - capexInHold;
  const solved = solvedPrice(cf, CloseCost);
  return {
    unleveredIrr: irr(cf.unleveredCF),
    unleveredMultiple: equityMultiple(cf.unleveredCF),
    leveredIrr: irr(cf.leveredCF),
    leveredMultiple: equityMultiple(cf.leveredCF),
    goingInCap: cf.noi[1] / PurchPrice,
    yieldOnCost: costBasis !== 0 ? cf.noi[Math.min(2, Hold)] / costBasis : null,
    equityAtClose: -cf.leveredCF[0],
    avgCashOnCash: coc.length ? sum(coc) / coc.length : 0,
    minDscr: dscr.length ? Math.min(...dscr) : null,
    grossExitValue: sum(cf.grossExit),
    netSaleProceeds: sum(cf.netSale),
    loanBalanceAtExit: -sum(cf.loanPayoff),
    year1Noi: cf.noi[1],
    loanAmount: cf.loanProceeds[0],
    solvedPrice: solved,
    solvedPricePerAcre: solved / Acres,
    priceVsSolved: PurchPrice / solved - 1,
    reassessedYear1Tax: PurchPrice * TaxRate,
    capexAfterExit: capexAfterExit(inputs),
  };
}

// --- Sens -------------------------------------------------------------------

/** Steps either side of center (Sens blocks are (k-2)*Step for k = 0..4). */
export const SENS_STEPS = [-2, -1, 0, 1, 2] as const;

/**
 * The Sens tab: each cell rebuilds NOI with the rent-growth shift (tenants
 * with no stated bump only) and capitalises the forward NOI at the shifted
 * exit cap. Debt is unchanged, so levered = unlevered + debt service in hold
 * + loan payoff -- exactly CashFlow rows 46/56 with the overrides applied.
 */
export function sensitivity(inputs: UwInputs): SensitivityGrid {
  const { ExitCap } = activeLevers(inputs);
  const growthShifts = SENS_STEPS.map((k) => k * inputs.StepG);
  const exitCaps = SENS_STEPS.map((k) => ExitCap + k * inputs.StepCap);
  const unlevered: Array<Array<number | null>> = [];
  const levered: Array<Array<number | null>> = [];
  for (const growthShift of growthShifts) {
    const u: Array<number | null> = [];
    const l: Array<number | null> = [];
    for (const cap of exitCaps) {
      const cf = buildCashFlow(inputs, { growthShift, ExitCap: cap });
      u.push(irr(cf.unleveredCF));
      l.push(irr(cf.leveredCF));
    }
    unlevered.push(u);
    levered.push(l);
  }
  return { growthShifts, exitCaps, unlevered, levered };
}

// --- Entry point ------------------------------------------------------------

export function runUnderwriting(inputs: UwInputs): UwResult {
  const cashFlow = buildCashFlow(inputs);
  return {
    scenario: inputs.scenario,
    active: activeLevers(inputs),
    cashFlow,
    returns: computeReturns(inputs, cashFlow),
    sensitivity: sensitivity(inputs),
  };
}
