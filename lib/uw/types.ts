// lib/uw/types.ts
//
// Inputs and outputs of the IOS underwriting engine. Field names deliberately
// keep the defined names of the source workbook (fixtures/Rendon_Rd_IOS_DCF.xlsx)
// -- Hold, ExitCap, RentGrowth, TaxSwitch... -- so every number can be traced
// back to a named cell. Where the workbook has no name, the comment gives the
// sheet and cell.

export const SCENARIOS = ["Base", "Upside", "Downside"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

/** One value per scenario, in the workbook's column order: [Base, Upside, Downside]. */
export type ByScenario<T> = readonly [T, T, T];

/** Inputs!A4:D9 -- the per-scenario levers. The "Active" column E is derived. */
export interface ScenarioLevers {
  RentGrowth: ByScenario<number>;
  Vacancy: ByScenario<number>;
  ExitCap: ByScenario<number>;
  CapexOverrun: ByScenario<number>;
  /** Months added to the start of every Pipeline tenant. */
  LeaseDelay: ByScenario<number>;
}

/** One RentRoll row (RentRoll!A6:O15). */
export interface Tenant {
  name: string;
  /** Col C. Only "Pipeline" tenants are pushed out by LeaseDelay. */
  status: "In-place" | "Pipeline";
  /** Col E. Informational, except where a Capex item links to it. */
  acres: number | null;
  /** Col F, quoted per `rentPeriod`. */
  rent: number;
  /** Col G. */
  rentPeriod: "Monthly" | "Annual";
  /** Col I. Null = no stated bump, so market RentGrowth applies. */
  bump: number | null;
  /** Col J, months from closing. */
  startMonth: number;
  /** Col K, months from closing. Null = month-to-month / no stated term (never expires). */
  leaseEndMonth: number | null;
  /** Col L. Share of rent kept after lease end. Null behaves as 0 (blank cell). */
  retention: number | null;
  /** Cols M:O. */
  include: ByScenario<number>;
}

/** One Capex row (Capex!A6:I9). */
export interface CapexItem {
  name: string;
  /** Col C. */
  unitCost: number;
  /**
   * Col D. A number, or a link to a RentRoll tenant's acres -- Capex!D6 is
   * =RentRoll!E15, so the paving quantity follows the large tenant's acreage.
   */
  units: number | { tenantAcres: number };
  /** Col E, year incurred (1-10). */
  year: number;
  /**
   * Cols G:I. Either fixed per-scenario flags, or derived from RentRoll: the
   * MAX of the listed tenants' include % for the scenario. Lease-up paving is
   * only built when the tenants it serves are in the scenario (Phase 1b fix).
   */
  include: ByScenario<number> | { tenantIncl: number[] };
}

export interface UwInputs {
  property: string;
  /** Dashboard!D4 -> Inputs!B11; ScenIdx is its 1-based position. */
  scenario: ScenarioName;
  levers: ScenarioLevers;

  Acres: number;
  /** INPUT price. The solved price does not depend on it (except via LoanLTV for debt). */
  PurchPrice: number;
  CompPerAcre: number;
  CloseCost: number;
  SaleCost: number;
  /** Integer 1-10. */
  Hold: number;
  TgtUnlev: number;
  TgtLev: number;
  MinDSCR: number;
  StepG: number;
  StepCap: number;

  SellerTax: number;
  Insurance: number;
  /** 0 = seller's current tax, 1 = reassess at PurchPrice x TaxRate. */
  TaxSwitch: 0 | 1;
  TaxRate: number;
  MgmtPct: number;
  ReservePerAcre: number;
  OtherOpex: number;
  ExpGrowth: number;

  LevOn: 0 | 1;
  LoanLTV: number;
  /** >= 0. At 0 the loan amortises straight-line (loan / AmortYrs per year after IO). */
  LoanRate: number;
  /** Integer years. */
  AmortYrs: number;
  /** Integer years. */
  IOYrs: number;
  LoanFee: number;

  rentRoll: Tenant[];
  capex: CapexItem[];
}

/** Columns C..N of CashFlow: years 0..11. Index = year. */
export type YearSeries = number[];

/** The CashFlow tab, row by row. Every series has length 12 (years 0..11). */
export interface CashFlowTable {
  /** Row 4. */
  year: YearSeries;
  /** Row 5. */
  inHold: YearSeries;
  /** Row 6. */
  exitFlag: YearSeries;
  /** Rows 9-18, one series per tenant, in RentRoll order. */
  tenantRevenue: YearSeries[];
  /** Row 19. */
  totalRevenue: YearSeries;
  /** Row 20 (negative). */
  vacancy: YearSeries;
  /** Row 21. */
  egr: YearSeries;
  /** Rows 24-27 (negative). */
  propertyTax: YearSeries;
  insurance: YearSeries;
  otherOpex: YearSeries;
  mgmtFee: YearSeries;
  /** Row 28. */
  totalOpex: YearSeries;
  /** Row 30. */
  noi: YearSeries;
  /** Row 31: NOI with the reassessed tax added back (price-solve helper). */
  noiExReassessedTax: YearSeries;
  /** Row 32: reassessed tax per $1 of price (price-solve helper). */
  reassessedTaxPerDollar: YearSeries;
  /** Rows 35-36 (negative). */
  capex: YearSeries;
  reserves: YearSeries;
  /** Rows 39-46. Row 39 lives in year 0 only. */
  purchase: YearSeries;
  noiInHold: YearSeries;
  capexInHold: YearSeries;
  forwardNoi: YearSeries;
  grossExit: YearSeries;
  saleCosts: YearSeries;
  netSale: YearSeries;
  unleveredCF: YearSeries;
  /** Rows 49-56. Proceeds and fee live in year 0 only. */
  loanProceeds: YearSeries;
  loanFee: YearSeries;
  interest: YearSeries;
  principal: YearSeries;
  debtService: YearSeries;
  loanBalance: YearSeries;
  loanPayoff: YearSeries;
  leveredCF: YearSeries;
  /** Rows 57-58. Null where the workbook shows "". */
  cashOnCash: Array<number | null>;
  dscr: Array<number | null>;
  /** Rows 61-63. */
  discountFactor: YearSeries;
  priceSolveCF: YearSeries;
  priceSolveTaxCost: YearSeries;
}

/** CashFlow!A66:C83. IRRs and ratios are null where the workbook shows "n/m" or an error. */
export interface Returns {
  unleveredIrr: number | null;
  unleveredMultiple: number | null;
  leveredIrr: number | null;
  leveredMultiple: number | null;
  goingInCap: number;
  /** NOI in year MIN(2, Hold) / (price x (1 + CloseCost) + capex scheduled inside the hold). */
  yieldOnCost: number | null;
  equityAtClose: number;
  avgCashOnCash: number;
  /** Null when there is no debt service in the hold (the Dashboard shows "n/a"). */
  minDscr: number | null;
  grossExitValue: number;
  netSaleProceeds: number;
  loanBalanceAtExit: number;
  year1Noi: number;
  loanAmount: number;
  solvedPrice: number;
  solvedPricePerAcre: number;
  priceVsSolved: number;
  reassessedYear1Tax: number;
  /**
   * Scenario capex for items booked after the exit year. A warning only: these
   * costs are not charged to the hold cash flows.
   */
  capexAfterExit: number;
}

/** Sens tab: rows are rent-growth shifts, columns exit caps. Center = headline. */
export interface SensitivityGrid {
  /** Shift added to RentGrowth for tenants with no stated bump (Sens!B6, B20...). */
  growthShifts: number[];
  /** Sens!B79:B83. */
  exitCaps: number[];
  unlevered: Array<Array<number | null>>;
  levered: Array<Array<number | null>>;
}

export interface UwResult {
  scenario: ScenarioName;
  /** Inputs!E5:E9 -- the levers for the active scenario. */
  active: { RentGrowth: number; Vacancy: number; ExitCap: number; CapexOverrun: number; LeaseDelay: number };
  cashFlow: CashFlowTable;
  returns: Returns;
  sensitivity: SensitivityGrid;
}
