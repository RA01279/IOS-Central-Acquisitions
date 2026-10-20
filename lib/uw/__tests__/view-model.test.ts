// The Underwriting tab's view model on the Rendon fixture.

import { describe, expect, it } from "vitest";
import { RENDON_CASES, rendon } from "../fixtures/rendon";
import { buildUwView, MODEL_NOTES, type UwView } from "../view-model";

const kpi = (v: UwView, key: string) => v.kpis.find((k) => k.key === key)!;
const pct4 = (v: number | null) => (v === null ? null : Number((v * 100).toFixed(4)));
const row = (v: UwView, label: string) => v.cashFlow.find((r) => r.label === label)!;

describe("buildUwView on the Rendon fixture (Base)", () => {
  const v = buildUwView(rendon);

  it("KPIs match the golden Base numbers", () => {
    expect(pct4(kpi(v, "unleveredIrr").value)).toBe(10.5295);
    expect(pct4(kpi(v, "leveredIrr").value)).toBe(13.8939);
    expect(Math.round(kpi(v, "year1Noi").value!)).toBe(427_815);
    expect(Math.round(kpi(v, "solvedPrice").value!)).toBe(5_656_335);
    expect(Math.round(kpi(v, "grossExit").value!)).toBe(7_211_102);
    expect(Number(kpi(v, "minDscr").value!.toFixed(3))).toBe(1.83);
    expect(pct4(kpi(v, "yieldOnCost").value)).toBe(7.907);
  });

  it("formats the KPIs for display", () => {
    expect(kpi(v, "unleveredIrr").display).toBe("10.53%");
    expect(kpi(v, "year1Noi").display).toBe("$427,815");
    expect(kpi(v, "solvedPrice").display).toBe("$5,656,335");
    expect(kpi(v, "minDscr").display).toBe("1.83x");
    expect(v.kpis.map((k) => k.key)).toEqual(["unleveredIrr", "leveredIrr", "year1Noi", "solvedPrice", "grossExit", "minDscr", "yieldOnCost"]);
  });

  it("cash-flow rows cover years 0..Hold and match the engine", () => {
    expect(v.years).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const r of v.cashFlow) expect(r.values).toHaveLength(8);
    expect(Math.round(row(v, "NOI").values[1]!)).toBe(427_815);
    expect(row(v, "NOI").values[0]).toBeNull();
    expect(Math.round(row(v, "Unlevered cash flow").values[0]!)).toBe(-5_582_500);
    expect(Math.round(row(v, "Levered cash flow").values[0]!)).toBe(-2_587_750);
    expect(Math.round(row(v, "Net sale proceeds").values[7]!)).toBe(7_066_880);
  });

  it("both 5x5 grids, center cell = headline IRR and the only highlighted cell", () => {
    const [u, l] = v.sensitivities;
    for (const g of [u, l]) {
      expect(g.cells).toHaveLength(5);
      g.cells.forEach((r) => expect(r).toHaveLength(5));
      expect(g.cells.flat().filter((c) => c.center)).toHaveLength(1);
      expect(g.cells[2][2].center).toBe(true);
    }
    expect(u.cells[2][2].value).toBe(kpi(v, "unleveredIrr").value);
    expect(l.cells[2][2].value).toBe(kpi(v, "leveredIrr").value);
    expect(u.exitCapLabels).toEqual(["6.00%", "6.50%", "7.00%", "7.50%", "8.00%"]);
    expect(u.growthLabels).toEqual(["1.0%", "2.0%", "3.0%", "4.0%", "5.0%"]);
  });

  it("no capex-after-exit warning, and the model notes are attached", () => {
    expect(v.warnings.some((w) => /after the Year/.test(w))).toBe(false);
    expect(v.modelNotes).toBe(MODEL_NOTES);
    expect(v.modelNotes.length).toBeGreaterThan(0);
  });
});

describe("buildUwView on other cases", () => {
  it("Upside", () => {
    const v = buildUwView(RENDON_CASES.Upside);
    expect(v.scenario).toBe("Upside");
    expect(pct4(kpi(v, "unleveredIrr").value)).toBe(18.6759);
    expect(pct4(kpi(v, "leveredIrr").value)).toBe(27.1419);
    expect(Math.round(kpi(v, "solvedPrice").value!)).toBe(8_609_193);
  });

  it("Downside", () => {
    const v = buildUwView(RENDON_CASES.Downside);
    expect(v.scenario).toBe("Downside");
    expect(pct4(kpi(v, "unleveredIrr").value)).toBe(0.8742);
    expect(pct4(kpi(v, "leveredIrr").value)).toBe(-8.2791);
    expect(kpi(v, "leveredIrr").display).toBe("-8.28%");
    expect(Math.round(kpi(v, "solvedPrice").value!)).toBe(3_304_431);
    // Min DSCR 1.180 is below the 1.25x floor.
    expect(v.warnings.some((w) => /below the 1.25x floor/.test(w))).toBe(true);
  });

  it("warns about capex scheduled after the exit", () => {
    const v = buildUwView(RENDON_CASES.CapexAfterExit);
    expect(v.warnings.some((w) => w.includes("$45,000 of capex is scheduled after the Year-7 exit"))).toBe(true);
  });
});
