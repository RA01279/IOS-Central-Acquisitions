// lib/uw/fixtures/rendon.ts
//
// The default inputs of fixtures/Rendon_Rd_IOS_DCF.xlsx (3879 Rendon Rd), as
// saved. This is the test input for the golden tests; each value cites its cell.

import type { UwInputs } from "../types";

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

  // Capex!A6:I9
  capex: [
    // Capex!D6 = RentRoll!E15 (the large tenant's acres, index 9 above).
    { name: "Gravel/paving & grading: large tenant lot", unitCost: 35_000, units: { tenantAcres: 9 }, year: 1, include: [0, 1, 0] },
    { name: "Gravel/paving: Prime +1 ac & Straight 6 spots", unitCost: 35_000, units: 1.5, year: 1, include: [1, 1, 0] },
    { name: "Perimeter fencing & gates", unitCost: 60_000, units: 1, year: 1, include: [1, 1, 1] },
    { name: "Site lighting", unitCost: 45_000, units: 1, year: 2, include: [1, 1, 1] },
  ],
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
