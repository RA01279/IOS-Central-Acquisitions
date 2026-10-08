// Golden tests: the engine against fixtures/Rendon_Rd_IOS_DCF.xlsx.
//
// A. The scenario table from docs/uw-build-plan.md. Dollars must equal the
//    workbook after rounding to the nearest dollar; IRRs must match to four
//    decimal places of a percent.
// B. Base, year by year, against the cached values saved in the workbook's
//    CashFlow tab (years 1-11), plus the Sens grid and the CashFlow returns.

import path from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { activeLevers, buildCashFlow, capexScenarioCost, runUnderwriting } from "../engine";
import { CASHFLOW_CHECK_ROWS, RENDON_CASES, RENDON_FIXTURE_PATH, rendon } from "../fixtures/rendon";
import type { UwInputs } from "../types";

const pct4 = (v: number | null) => (v === null ? null : Number((v * 100).toFixed(4)));

interface Golden {
  name: keyof typeof RENDON_CASES;
  unlev: number;
  lev: number;
  noi1?: number;
  solved: number;
  grossExit: number;
  minDscr: number;
  /** Yield on cost, percent to 4 dp. */
  yoc: number;
}

const GOLDEN: Golden[] = [
  { name: "Base", unlev: 10.5295, lev: 13.8939, noi1: 427_815, solved: 5_656_335, grossExit: 7_211_102, minDscr: 1.83, yoc: 7.907 },
  { name: "Upside", unlev: 18.6759, lev: 27.1419, noi1: 553_369, solved: 8_609_193, grossExit: 11_625_231, minDscr: 2.597, yoc: 11.3178 },
  { name: "Downside", unlev: 0.8742, lev: -8.2791, noi1: 287_210, solved: 3_304_431, grossExit: 3_985_410, minDscr: 1.18, yoc: 5.1465 },
  { name: "Hold 5", unlev: 10.651, lev: 14.2977, noi1: 427_815, solved: 5_646_088, grossExit: 6_797_155, minDscr: 1.83, yoc: 7.907 },
  { name: "Hold 10", unlev: 10.4396, lev: 13.4767, noi1: 427_815, solved: 5_669_388, grossExit: 7_879_766, minDscr: 1.83, yoc: 7.907 },
  { name: "Reassessed", unlev: 4.4673, lev: 1.6442, noi1: 311_815, solved: 4_385_140, grossExit: 5_173_025, minDscr: 1.339, yoc: 5.8254 },
];

// Phase 1b cases.
const GOLDEN_1B: Golden[] = [
  { name: "LargeInBase", unlev: 16.4591, lev: 23.8145, solved: 7_681_876, grossExit: 10_015_214, minDscr: 2.505, yoc: 10.9989 },
  { name: "Rate0", unlev: 10.5295, lev: 19.9099, solved: 5_656_335, grossExit: 7_211_102, minDscr: 3.793, yoc: 7.907 },
  { name: "Hold1", unlev: 19.4688, lev: 32.9401, solved: 5_973_438, grossExit: 6_483_703, minDscr: 2.095, yoc: 7.5121 },
  { name: "CapexAfterExit", unlev: 10.6549, lev: 14.151, solved: 5_692_976, grossExit: 7_211_102, minDscr: 1.83, yoc: 7.9694 },
];

function checkGolden(g: Golden) {
  const r = runUnderwriting(RENDON_CASES[g.name]).returns;
  expect(pct4(r.unleveredIrr), "unlevered IRR").toBe(g.unlev);
  expect(pct4(r.leveredIrr), "levered IRR").toBe(g.lev);
  if (g.noi1 !== undefined) expect(Math.round(r.year1Noi), "Yr-1 NOI").toBe(g.noi1);
  expect(Math.round(r.solvedPrice), "solved price").toBe(g.solved);
  expect(Math.round(r.grossExitValue), "gross exit").toBe(g.grossExit);
  expect(Number(r.minDscr!.toFixed(3)), "min DSCR").toBe(g.minDscr);
  expect(pct4(r.yieldOnCost), "yield on cost").toBe(g.yoc);
}

/** Capex!K10: total scenario capex, whenever it is booked. */
const totalScenarioCapex = (inputs: UwInputs) =>
  inputs.capex.reduce((s, c) => s + capexScenarioCost(c, inputs, activeLevers(inputs).CapexOverrun), 0);

describe("A. golden scenario table", () => {
  for (const g of GOLDEN) {
    it(g.name, () => checkGolden(g));
  }
});

describe("A2. Phase 1b golden cases", () => {
  for (const g of GOLDEN_1B) {
    it(g.name, () => checkGolden(g));
  }

  it("LargeInBase: the large tenant's paving is now built (total scenario capex 358,750)", () => {
    expect(Math.round(totalScenarioCapex(RENDON_CASES.LargeInBase))).toBe(358_750);
  });

  it("Rate0: debt service yr 1 = 0, yr 4 = -121,000; loan balance end of yr 7 = 2,420,000", () => {
    const cf = runUnderwriting(RENDON_CASES.Rate0).cashFlow;
    expect(cf.debtService[1]).toBe(0);
    expect(Math.round(cf.debtService[4])).toBe(-121_000);
    expect(Math.round(cf.loanBalance[7])).toBe(2_420_000);
  });

  it("Hold1: capexAfterExit = 45,000", () => {
    expect(Math.round(runUnderwriting(RENDON_CASES.Hold1).returns.capexAfterExit)).toBe(45_000);
  });

  it("CapexAfterExit: capexAfterExit = 45,000; total scenario capex still 157,500", () => {
    const inputs = RENDON_CASES.CapexAfterExit;
    const { returns, cashFlow } = runUnderwriting(inputs);
    expect(Math.round(returns.capexAfterExit)).toBe(45_000);
    expect(Math.round(totalScenarioCapex(inputs))).toBe(157_500);
    // Still not charged to the hold.
    expect(cashFlow.capexInHold.reduce((s, v) => s + v, 0)).toBeCloseTo(-112_500, 6);
  });

  for (const g of GOLDEN) {
    it(`${g.name}: capexAfterExit is 0`, () => {
      expect(runUnderwriting(RENDON_CASES[g.name]).returns.capexAfterExit).toBe(0);
    });
  }
});

// --- Workbook cached values -------------------------------------------------

type Ws = ExcelJS.Worksheet;
let cashFlowWs: Ws;
let sensWs: Ws;

/**
 * The value Excel/LibreOffice last saved in a cell. ExcelJS drops a cached
 * result of 0 (it reads as undefined), so a formula cell with no result is 0
 * -- checked against the raw sheet XML, where those cells hold <v>0</v>.
 */
function cached(ws: Ws, address: string): number {
  const v = ws.getCell(address).value as unknown;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "formula" in v) {
    const result = (v as { result?: unknown }).result;
    if (result === undefined || result === null) return 0;
    if (typeof result === "number") return result;
  }
  throw new Error(`${ws.name}!${address} has no numeric cached value (${JSON.stringify(v)})`);
}

const col = (year: number) => String.fromCharCode("C".charCodeAt(0) + year); // year 0 = C

beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(process.cwd(), RENDON_FIXTURE_PATH));
  cashFlowWs = wb.getWorksheet("CashFlow")!;
  sensWs = wb.getWorksheet("Sens")!;
});

describe("B. Base year by year vs the workbook's cached CashFlow", () => {
  it("rows 19, 21, 30, 46, 53, 54, 56 match for years 1-11", () => {
    const cf = buildCashFlow(rendon);
    let maxDiff = 0;
    let where = "";
    for (const [key, row] of Object.entries(CASHFLOW_CHECK_ROWS)) {
      const series = cf[key as keyof typeof CASHFLOW_CHECK_ROWS];
      for (let year = 1; year <= 11; year++) {
        const expected = cached(cashFlowWs, `${col(year)}${row}`);
        const diff = Math.abs(series[year] - expected);
        if (diff > maxDiff) {
          maxDiff = diff;
          where = `CashFlow!${col(year)}${row} (${key}, year ${year})`;
        }
        expect(series[year], `CashFlow!${col(year)}${row}`).toBeCloseTo(expected, 6);
      }
    }
    // Year 0 lines too: purchase, loan, equity.
    expect(cf.unleveredCF[0]).toBeCloseTo(cached(cashFlowWs, "C46"), 6);
    expect(cf.loanBalance[0]).toBeCloseTo(cached(cashFlowWs, "C54"), 6);
    expect(cf.leveredCF[0]).toBeCloseTo(cached(cashFlowWs, "C56"), 6);
    console.log(`[golden] max absolute cash-flow difference: $${maxDiff.toExponential(3)} at ${where || "n/a"}`);
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it("returns summary matches CashFlow!C66:C83", () => {
    const r = runUnderwriting(rendon).returns;
    const pairs: Array<[number | null, string]> = [
      [r.unleveredIrr, "C66"], [r.unleveredMultiple, "C67"], [r.leveredIrr, "C68"], [r.leveredMultiple, "C69"],
      [r.goingInCap, "C70"], [r.yieldOnCost, "C71"], [r.equityAtClose, "C72"], [r.avgCashOnCash, "C73"],
      [r.minDscr, "C74"], [r.grossExitValue, "C75"], [r.netSaleProceeds, "C76"], [r.loanBalanceAtExit, "C77"],
      [r.year1Noi, "C78"], [r.loanAmount, "C79"], [r.solvedPrice, "C80"], [r.solvedPricePerAcre, "C81"],
      [r.priceVsSolved, "C82"], [r.reassessedYear1Tax, "C83"],
    ];
    for (const [actual, addr] of pairs) {
      expect(actual, `CashFlow!${addr}`).not.toBeNull();
      // Relative: these mix ratios and dollar amounts, and float rounding in
      // e.g. 5,500,000 x 1.015 leaves ~1e-9 on a $2.6M figure.
      const expected = cached(cashFlowWs, addr);
      expect(Math.abs(actual! - expected), `CashFlow!${addr}`).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(expected)));
    }
  });

  it("sensitivity grids match Sens!O79:O103 (unlevered) and O106:O130 (levered)", () => {
    const s = runUnderwriting(rendon).sensitivity;
    for (let g = 0; g < 5; g++) {
      for (let c = 0; c < 5; c++) {
        const k = g * 5 + c;
        expect(s.unlevered[g][c]!, `Sens!O${79 + k}`).toBeCloseTo(cached(sensWs, `O${79 + k}`), 10);
        expect(s.levered[g][c]!, `Sens!O${106 + k}`).toBeCloseTo(cached(sensWs, `O${106 + k}`), 10);
      }
      expect(s.exitCaps[g]).toBeCloseTo(cached(sensWs, `B${79 + g}`), 12);
    }
  });
});
