import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseReturnsSummary } from "./excel-parser";
import { workbookWarnings } from "./workbook-messages";

const LEGACY_NOTE = "Workbook returns are cached source values; Hopper does not recalculate Excel formulas. Verify workbook identity and recalculate/save in Excel before relying on them.";

/** A minimal IOS Pro Forma laid out like the template: labels in column B, values in C/D/E/F. */
function proForma(workbook: ExcelJS.Workbook, opts: { address?: string; goingIn?: ExcelJS.CellValue } = {}) {
  const s = workbook.addWorksheet("Pro Forma");
  s.getCell("D7").value = "Levered LP Returns"; s.getCell("E7").value = "Unlevered"; s.getCell("F7").value = "Levered";
  s.getCell("B8").value = "IRR"; s.getCell("E8").value = 0.13; s.getCell("F8").value = { formula: "X", result: 0.1977 };
  s.getCell("B10").value = "Multiple"; s.getCell("F10").value = 2.01;
  s.getCell("B11").value = "Avg. Cash-on-Cash"; s.getCell("F11").value = 0.0723;
  s.getCell("B16").value = "Address"; s.getCell("F16").value = opts.address ?? "100 Test Road";
  s.getCell("B17").value = "City, State"; s.getCell("F17").value = "Houston, TX ";
  s.getCell("B18").value = "Lot Size (Acre / SF)"; s.getCell("E18").value = 3.97;
  s.getCell("B20").value = "Building SF"; s.getCell("F20").value = 7500;
  s.getCell("B33").value = "Purchase Price"; s.getCell("F33").value = 3000000;
  s.getCell("B52").value = "Total All-in Cost"; s.getCell("F52").value = 3365356;
  s.getCell("B77").value = "Going-in Cap Rate (tax adj.)"; s.getCell("C77").value = opts.goingIn ?? 0.05;
  s.getCell("B81").value = "Yield on Cost at Exit"; s.getCell("C81").value = 0.0894;
  s.getCell("B151").value = "Month of Sale"; s.getCell("D151").value = 48;
  s.getCell("B162").value = "Market Rent"; s.getCell("E162").value = 3.68;
  s.getCell("B165").value = "Exit Cap"; // section heading, no value
  s.getCell("B168").value = "Exit Cap"; s.getCell("F168").value = 0.0675;
  return s;
}

async function ios(value: ExcelJS.CellValue) {
  const workbook = new ExcelJS.Workbook();
  proForma(workbook, { goingIn: value });
  return parseReturnsSummary(Buffer.from(await workbook.xlsx.writeBuffer()), "100 Test Road");
}

describe("workbook upload messages", () => {
  it("imports saved formula results without a generic parser warning", async () => {
    const result = await ios({ formula: "1/10", result: 0.1 });
    expect(result.goingInYieldPct).toBe(0.1);
    expect(result.warnings).toEqual([]);
  });
  it("preserves zero saved calculation results", async () => {
    const result = await ios({ formula: "0/10", result: 0 });
    expect(result.goingInYieldPct).toBe(0);
    expect(result.warnings).toEqual([]);
  });
  it("flags formulas without saved results rather than treating them as returns", async () => {
    const result = await ios({ formula: "1/10" });
    expect(result.goingInYieldPct).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/C77.*no saved numeric calculation result.*Recalculate/);
  });
  it.each(["#DIV/0!", "#REF!"] as const)("identifies a saved formula error %s", async (error) => {
    const result = await ios({ formula: "1/0", result: { error } });
    expect(result.goingInYieldPct).toBeNull();
    expect(result.warnings.join(" ")).toContain(error);
    expect(result.warnings.join(" ")).not.toContain("[object Object]");
  });
  it("identifies an Excel error stored directly in a cell", async () => {
    const result = await ios({ error: "#DIV/0!" });
    expect(result.goingInYieldPct).toBeNull();
    expect(result.warnings.join(" ")).toContain("formula error (#DIV/0!)");
  });
  it("removes only the generic historical note from existing versions", () => {
    const issue = '"IRR" contains a formula error (#REF!) in the source workbook';
    expect(workbookWarnings([LEGACY_NOTE, issue])).toEqual([issue]);
    expect(workbookWarnings(undefined)).toEqual([]);
  });
  it("retains property identity discrepancies", async () => {
    const workbook = new ExcelJS.Workbook();
    proForma(workbook, { address: "200 Other Road" });
    const result = await parseReturnsSummary(Buffer.from(await workbook.xlsx.writeBuffer()), "100 Test Road");
    expect(result.warnings.join(" ")).toMatch(/identity discrepancy/);
  });
  it("reads every return from the visible Pro Forma by row label", async () => {
    const result = await ios(0.05);
    expect(result).toMatchObject({ purchasePrice: 3000000, allInCost: 3365356, goingInYieldPct: 0.05, stabilizedReturnOnCostPct: 0.0894, exitCapPct: 0.0675,
      marketRentPsfMo: 3.68, holdPeriodYears: 4, irrPct: 0.1977, equityMultiple: 2.01, stabilizedCashOnCashPct: 0.0723,
      sourceIdentity: { address: "100 Test Road", city: "Houston, TX", acres: 3.97, buildingSf: 7500 } });
    expect(result.warnings).toEqual([]);
  });
  it("never reads the hidden Summary Table, even when it holds other numbers", async () => {
    const workbook = new ExcelJS.Workbook();
    const stale = workbook.addWorksheet("Summary Table", { state: "hidden" });
    stale.getCell("F7").value = 2900000; stale.getCell("G24").value = 0.2104;
    proForma(workbook);
    const result = await parseReturnsSummary(Buffer.from(await workbook.xlsx.writeBuffer()), "100 Test Road");
    expect([result.purchasePrice, result.irrPct]).toEqual([3000000, 0.1977]);
  });
  it("reports missing Pro Forma rows in one plain warning", async () => {
    const workbook = new ExcelJS.Workbook();
    proForma(workbook).getCell("B81").value = "Something else";
    const result = await parseReturnsSummary(Buffer.from(await workbook.xlsx.writeBuffer()), "100 Test Road");
    expect(result.stabilizedReturnOnCostPct).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/Pro Forma rows not found or empty: "Yield on Cost at Exit"/);
  });
  it("makes an existing unreadable-cell warning actionable without hiding it", () => {
    expect(workbookWarnings(['"goingInYieldPct (F14)" expected a number, found "[object Object]"']))
      .toEqual(['A numeric result for "goingInYieldPct (F14)" was not captured in this saved version. Upload the workbook again to read this result.']);
  });
  it("preserves a saved zero return in industrial models too", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("_Upload_");
    const labels = ["Purchase Price", "Total Sources", "In-Place Cap on PP", "Stab cap-on-all-in (Yield to Cost)", "Exit Cap with adj", "Last sale", "Gross IRR Lev", "Gross Equity Mult.", "Lev Avg CoC"];
    labels.forEach((label, index) => {
      sheet.getCell(`B${index + 1}`).value = label;
      sheet.getCell(`C${index + 1}`).value = { formula: "0", result: 0 };
    });
    const result = await parseReturnsSummary(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(result.irrPct).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});
