// lib/uw/fixtures/rendon.ts
//
// The default inputs of fixtures/Rendon_Rd_IOS_DCF.xlsx (3879 Rendon Rd), as
// saved. This is the test input for the golden tests; each value cites its cell.

import type { Tenant, UwInputs } from "../types";

export const RENDON_FIXTURE_PATH = "fixtures/Rendon_Rd_IOS_DCF.xlsx";

export const rendon: UwInputs = {
  property: "3879 Rendon Rd", // Inputs!B15
  scenario: "Base", // Dashboard!D4
  levers: {
    RentGrowth: [0.03, 0.04, 0.015], // Inputs!B5:D5
    Vacancy: [0.05, 0.03, 0.1], // Inputs!B6:D6
    ExitCap: [0.07, 0.065, 0.0775], // Inputs!B7:D7
    CapexOverrun: [0, 0, 0.15], // Inputs!B8:D8
    LeaseDelay: [0, 0, 6], // Inputs!B9:D9
  },

  Acres: 37, // Inputs!B16
  PurchPrice: 5_500_000, // Inputs!B17
  CompPerAcre: 150_000, // Inputs!B19
  CloseCost: 0.015, // Inputs!B21
  SaleCost: 0.02, // Inputs!B22
  Hold: 7, // Inputs!B23
  TgtUnlev: 0.1, // Inputs!B24
  TgtLev: 0.15, // Inputs!B25
  MinDSCR: 1.25, // Inputs!B26
  StepG: 0.01, // Inputs!B27
  StepCap: 0.005, // Inputs!B28

  SellerTax: 5_000, // Inputs!B31
  Insurance: 2_000, // Inputs!B32
  TaxSwitch: 0, // Inputs!B33
  TaxRate: 0.022, // Inputs!B34
  MgmtPct: 0, // Inputs!B35
  ReservePerAcre: 0, // Inputs!B36
  OtherOpex: 0, // Inputs!B37
  ExpGrowth: 0.03, // Inputs!B38

  LevOn: 1, // Inputs!B41
  LoanLTV: 0.55, // Inputs!B42
  LoanRate: 0.0675, // Inputs!B43
  AmortYrs: 25, // Inputs!B44
  IOYrs: 2, // Inputs!B45
  LoanFee: 0.01, // Inputs!B46

  // RentRoll!A6:O15
  rentRoll: [
    { name: "S&A Leasing", status: "In-place", acres: null, rent: 13_000, rentPeriod: "Monthly", bump: 0.03, startMonth: 0, leaseEndMonth: 60, retention: 0.85, include: [1, 1, 1] },
    { name: "Reindeer (Prime)", status: "In-place", acres: 1.56, rent: 7_000, rentPeriod: "Monthly", bump: null, startMonth: 0, leaseEndMonth: 24, retention: 0.9, include: [1, 1, 0] },
    { name: "Straight 6", status: "In-place", acres: 1, rent: 6_500, rentPeriod: "Monthly", bump: null, startMonth: 0, leaseEndMonth: null, retention: null, include: [1, 1, 1] },
    { name: "Big Dawgs (repo)", status: "In-place", acres: null, rent: 4_000, rentPeriod: "Monthly", bump: null, startMonth: 0, leaseEndMonth: null, retention: null, include: [1, 1, 1] },
    { name: "Individual tenants (various)", status: "In-place", acres: null, rent: 2_100, rentPeriod: "Monthly", bump: null, startMonth: 0, leaseEndMonth: null, retention: null, include: [1, 1, 0.75] },
    { name: "CDL driver training", status: "In-place", acres: 0.5, rent: 1_500, rentPeriod: "Monthly", bump: null, startMonth: 0, leaseEndMonth: null, retention: null, include: [1, 1, 1] },
    { name: "Alamo Fireworks", status: "In-place", acres: null, rent: 8_000, rentPeriod: "Annual", bump: null, startMonth: 0, leaseEndMonth: null, retention: null, include: [1, 1, 1] },
    { name: "Prime expansion (+1 ac)", status: "Pipeline", acres: 1, rent: 3_500, rentPeriod: "Monthly", bump: null, startMonth: 3, leaseEndMonth: null, retention: null, include: [1, 1, 0] },
    { name: "Straight 6 expansion (~10 spots)", status: "Pipeline", acres: null, rent: 1_000, rentPeriod: "Monthly", bump: null, startMonth: 3, leaseEndMonth: null, retention: null, include: [1, 1, 0] },
    { name: "Large tenant (~5.75 ac, in county)", status: "Pipeline", acres: 5.75, rent: 20_000, rentPeriod: "Monthly", bump: null, startMonth: 6, leaseEndMonth: 18, retention: 0.7, include: [0, 1, 0] },
  ],

  // Capex!A6:I9. Lease-up paving (rows 1-2) takes its include % from the
  // tenants it serves; site work (rows 3-4) keeps fixed 1/0 flags.
  capex: [
    // Capex!D6 = RentRoll!E15 (the large tenant's acres, index 9 above); included as that tenant is.
    { name: "Gravel/paving & grading: large tenant lot", unitCost: 35_000, units: { tenantAcres: 9 }, year: 1, include: { tenantIncl: [9] } },
    // MAX of the Prime expansion (index 7) and Straight 6 expansion (index 8).
    { name: "Gravel/paving: Prime +1 ac & Straight 6 spots", unitCost: 35_000, units: 1.5, year: 1, include: { tenantIncl: [7, 8] } },
    { name: "Perimeter fencing & gates", unitCost: 60_000, units: 1, year: 1, include: [1, 1, 1] },
    { name: "Site lighting", unitCost: 45_000, units: 1, year: 2, include: [1, 1, 1] },
  ],
};

const REINDEER = 1;
const LARGE_TENANT = 9;
const LIGHTING = 3;

/**
 * Base with per-tenant edits. `baseInclude` replaces only the Base include %;
 * Upside and Downside keep the fixture's values.
 */
function withTenants(edits: Record<number, Partial<Omit<Tenant, "include">> & { baseInclude?: number }>): UwInputs {
  return {
    ...rendon,
    rentRoll: rendon.rentRoll.map((t, i) => {
      const e = edits[i];
      if (!e) return t;
      const { baseInclude, ...rest } = e;
      return { ...t, ...rest, ...(baseInclude !== undefined ? { include: [baseInclude, t.include[1], t.include[2]] as const } : {}) };
    }),
  };
}

/** The golden-test cases: each is the fixture with one documented edit. */
export const RENDON_CASES: Record<string, UwInputs> = {
  Base: rendon,
  Upside: { ...rendon, scenario: "Upside" },
  Downside: { ...rendon, scenario: "Downside" },
  "Hold 5": { ...rendon, Hold: 5 },
  "Hold 10": { ...rendon, Hold: 10 },
  // Base with property tax reassessed at the input price.
  Reassessed: { ...rendon, TaxSwitch: 1 },
  // Phase 1b. Base with the large tenant at 100%, which now also builds its paving.
  LargeInBase: {
    ...rendon,
    rentRoll: rendon.rentRoll.map((t, i) => (i === LARGE_TENANT ? { ...t, include: [1, t.include[1], t.include[2]] as const } : t)),
  },
  Rate0: { ...rendon, LoanRate: 0 },
  Hold1: { ...rendon, Hold: 1 },
  // Lighting moved to year 9, after a 7-year exit.
  CapexAfterExit: {
    ...rendon,
    capex: rendon.capex.map((c, i) => (i === LIGHTING ? { ...c, year: 9 } : c)),
  },
  // Phase 3d. Large tenant at 100% with 3 months free from its start.
  FreeNew: withTenants({ [LARGE_TENANT]: { baseInclude: 1, freeRentMonths: 3 } }),
  // Reindeer gets 2 months free on renewal (weighted by its 90% retention).
  FreeRenew: withTenants({ [REINDEER]: { freeRentOnRenewalMonths: 2 } }),
  FreeBoth: withTenants({
    [LARGE_TENANT]: { baseInclude: 1, freeRentMonths: 3, freeRentOnRenewalMonths: 2 },
    [REINDEER]: { freeRentMonths: 1, freeRentOnRenewalMonths: 2 },
  }),
};

/** CashFlow rows checked year by year against the workbook's cached Base values. */
export const CASHFLOW_CHECK_ROWS = {
  totalRevenue: 19,
  egr: 21,
  noi: 30,
  unleveredCF: 46,
  debtService: 53,
  loanBalance: 54,
  leveredCF: 56,
} as const;
