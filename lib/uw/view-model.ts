// lib/uw/view-model.ts
//
// What the Underwriting tab shows, computed from engine inputs. Pure: no
// React, no I/O. Values come with display strings so the page stays a thin
// layout and the numbers can be tested here.

import { activeLevers, runUnderwriting } from "./engine";
import type { UwInputs } from "./types";

/**
 * Known simplifications, as listed on the workbook's Inputs tab (A48:A54).
 * Shown on every run so nobody reads the engine as more than it is.
 */
export const MODEL_NOTES: readonly string[] = [
  "Retained rent after a lease ends continues at the retention % with no downtime, TI or leasing commissions.",
  "Rent growth compounds from Year 1 even for tenants that start later.",
  "Pipeline tenants are excluded in Downside, so the Downside lease-up delay has no effect unless they are included there.",
  "The loan is sized on the input price only; levered returns at the solved price are not shown.",
  "Lease-up capex follows the tenants' include % on RentRoll; fencing and lighting are manual 1/0 flags per scenario.",
  "Capex scheduled after the exit year is not charged to the hold.",
];

export interface UwKpi {
  key: "unleveredIrr" | "leveredIrr" | "year1Noi" | "solvedPrice" | "grossExit" | "minDscr" | "yieldOnCost";
  label: string;
  value: number | null;
  display: string;
  sub?: string;
}

export interface UwCashFlowRow {
  label: string;
  /** Years 0..Hold. Null where the line has no value that year (shown blank). */
  values: Array<number | null>;
  format: "usd" | "ratio" | "pct";
  emphasis?: boolean;
}

export interface UwSensitivityGrid {
  title: string;
  /** Column headers: exit caps. */
  exitCaps: number[];
  exitCapLabels: string[];
  /** Row headers: market rent growth (RentGrowth + shift) for tenants without a stated bump. */
  growthLabels: string[];
  cells: Array<Array<{ value: number | null; display: string; center: boolean }>>;
}

export interface UwView {
  property: string;
  scenario: string;
  hold: number;
  kpis: UwKpi[];
  years: number[];
  cashFlow: UwCashFlowRow[];
  sensitivities: [UwSensitivityGrid, UwSensitivityGrid];
  warnings: string[];
  modelNotes: readonly string[];
}

export const fmtUsd = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "—" : `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
export const fmtPct = (v: number | null, dp = 2) =>
  v === null || !Number.isFinite(v) ? "n/m" : `${(v * 100).toFixed(dp)}%`;
export const fmtRatio = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);

export function buildUwView(inputs: UwInputs): UwView {
  const { cashFlow: cf, returns: r, sensitivity: s } = runUnderwriting(inputs);
  const lv = activeLevers(inputs);
  const H = inputs.Hold;
  const years = Array.from({ length: H + 1 }, (_, t) => t);
  const span = (series: readonly number[], fromYear = 1) => years.map((t) => (t < fromYear ? null : series[t]));

  const kpis: UwKpi[] = [
    { key: "unleveredIrr", label: "Unlevered IRR", value: r.unleveredIrr, display: fmtPct(r.unleveredIrr), sub: `${fmtRatio(r.unleveredMultiple)} multiple` },
    {
      key: "leveredIrr",
      label: "Levered IRR",
      value: r.leveredIrr,
      display: fmtPct(r.leveredIrr),
      sub: inputs.LevOn ? `${fmtRatio(r.leveredMultiple)} multiple` : "Leverage off",
    },
    { key: "year1Noi", label: "Yr-1 NOI", value: r.year1Noi, display: fmtUsd(r.year1Noi), sub: `${fmtPct(r.goingInCap)} going-in cap` },
    {
      key: "solvedPrice",
      label: "Solved price",
      value: r.solvedPrice,
      display: fmtUsd(r.solvedPrice),
      sub: `at ${fmtPct(inputs.TgtUnlev, 1)} unlevered · ${fmtUsd(r.solvedPricePerAcre)}/ac`,
    },
    { key: "grossExit", label: "Gross exit", value: r.grossExitValue, display: fmtUsd(r.grossExitValue), sub: `Yr ${H} at ${fmtPct(lv.ExitCap)} cap` },
    { key: "minDscr", label: "Min DSCR", value: r.minDscr, display: r.minDscr === null ? "n/a" : fmtRatio(r.minDscr), sub: `floor ${inputs.MinDSCR.toFixed(2)}x` },
    { key: "yieldOnCost", label: "Yield on cost", value: r.yieldOnCost, display: fmtPct(r.yieldOnCost), sub: `Yr-${Math.min(2, H)} NOI on total cost` },
  ];

  const cashFlow: UwCashFlowRow[] = [
    { label: "Total scenario revenue", values: span(cf.totalRevenue), format: "usd" },
    { label: "Vacancy & credit loss", values: span(cf.vacancy), format: "usd" },
    { label: "Effective gross revenue", values: span(cf.egr), format: "usd" },
    { label: "Operating expenses", values: span(cf.totalOpex), format: "usd" },
    { label: "NOI", values: span(cf.noi), format: "usd", emphasis: true },
    { label: "Capex, reserves & leasing", values: span(cf.capexInHold), format: "usd" },
    { label: "Purchase + closing", values: years.map((t) => (t === 0 ? cf.purchase[0] : null)), format: "usd" },
    { label: "Net sale proceeds", values: span(cf.netSale), format: "usd" },
    { label: "Unlevered cash flow", values: span(cf.unleveredCF, 0), format: "usd", emphasis: true },
    { label: "Loan proceeds, net of fee", values: years.map((t) => (t === 0 ? cf.loanProceeds[0] + cf.loanFee[0] : null)), format: "usd" },
    { label: "Debt service", values: span(cf.debtService), format: "usd" },
    { label: "Loan payoff", values: span(cf.loanPayoff), format: "usd" },
    { label: "Levered cash flow", values: span(cf.leveredCF, 0), format: "usd", emphasis: true },
    { label: "DSCR", values: years.map((t) => (t === 0 ? null : cf.dscr[t])), format: "ratio" },
    { label: "Cash-on-cash", values: years.map((t) => (t === 0 ? null : cf.cashOnCash[t])), format: "pct" },
  ];

  const grid = (title: string, irrs: Array<Array<number | null>>): UwSensitivityGrid => ({
    title,
    exitCaps: s.exitCaps,
    exitCapLabels: s.exitCaps.map((c) => fmtPct(c)),
    growthLabels: s.growthShifts.map((g) => fmtPct(lv.RentGrowth + g, 1)),
    cells: irrs.map((row, i) => row.map((value, j) => ({ value, display: fmtPct(value), center: i === 2 && j === 2 }))),
  });

  const warnings: string[] = [];
  if (r.capexAfterExit > 0) {
    warnings.push(`${fmtUsd(r.capexAfterExit)} of capex is scheduled after the Year-${H} exit and is not charged to the hold.`);
  }
  if (r.unleveredIrr === null) warnings.push("Unlevered IRR has no solution for these cash flows (n/m).");
  if (inputs.LevOn && r.leveredIrr === null) warnings.push("Levered IRR has no solution for these cash flows (n/m).");
  if (r.minDscr !== null && r.minDscr < inputs.MinDSCR) {
    warnings.push(`Minimum DSCR ${fmtRatio(r.minDscr)} is below the ${inputs.MinDSCR.toFixed(2)}x floor.`);
  }

  return {
    property: inputs.property,
    scenario: inputs.scenario,
    hold: H,
    kpis,
    years,
    cashFlow,
    sensitivities: [grid("Unlevered IRR", s.unlevered), grid("Levered IRR", s.levered)],
    warnings,
    modelNotes: MODEL_NOTES,
  };
}
