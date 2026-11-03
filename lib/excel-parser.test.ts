import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseReturnsSummary } from "./excel-parser";
import { workbookWarnings } from "./workbook-messages";

const LEGACY_NOTE = "Workbook returns are cached source values; Hopper does not recalculate Excel formulas. Verify workbook identity and recalculate/save in Excel before relying on them.";

async function ios(value: ExcelJS.CellValue) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Summary Table");
  workbook.addWorksheet("Pro Forma").getCell("F15").value = "100 Test Road";
  workbook.addWorksheet("Market Leasing Summary").getCell("D17").value = "$/SF/month";
  sheet.getCell("F14").value = value;
  sheet.getCell("G18").value = 1.5;
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
    expect(result.warnings.join(" ")).toMatch(/F14.*no saved numeric calculation result.*Recalculate/);
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
    workbook.addWorksheet("Summary Table").getCell("F14").value = 0.1;
    workbook.addWorksheet("Pro Forma").getCell("F15").value = "200 Other Road";
    const result = await parseReturnsSummary(Buffer.from(await workbook.xlsx.writeBuffer()), "100 Test Road");
    expect(result.warnings.join(" ")).toMatch(/identity discrepancy/);
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
