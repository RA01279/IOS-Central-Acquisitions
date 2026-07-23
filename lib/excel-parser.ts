// lib/excel-parser.ts
//
// Parses the "Summary Table" tab of the Dalfen underwriting model --
// that tab is a formula-linked one-pager pulling from Pro Forma, so it's
// the reliable source for headline returns rather than parsing the raw
// Pro Forma layout. Cell addresses below were mapped against
// 1717 Shady Oaks - V1 - CURRENT.xlsx; if a future template version
// moves these, this mapping needs to be updated to match (the sheet
// name and general layout have been stable across the versions checked).

import ExcelJS from "exceljs";

export interface ReturnsSummary {
  purchasePrice: number | null;
  allInCost: number | null;
  goingInYieldPct: number | null;
  stabilizedReturnOnCostPct: number | null;
  exitCapPct: number | null;
  marketRentPsfMo: number | null;
  holdPeriodYears: number | null;
  irrPct: number | null;
  equityMultiple: number | null;
  stabilizedCashOnCashPct: number | null;
  warnings: string[];
}

const CELLS: Record<keyof Omit<ReturnsSummary, "warnings">, string> = {
  purchasePrice: "F7",
  allInCost: "F12",
  goingInYieldPct: "F14",
  stabilizedReturnOnCostPct: "F15",
  exitCapPct: "F16",
  marketRentPsfMo: "G18",
  holdPeriodYears: "G23",
  irrPct: "G24",
  equityMultiple: "G25",
  stabilizedCashOnCashPct: "G26",
};

const SHEET_NAME = "Summary Table";

export async function parseReturnsSummary(buffer: Buffer): Promise<ReturnsSummary> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(
      `Expected a "${SHEET_NAME}" tab and didn't find one. Check this workbook matches the standard template.`
    );
  }

  const warnings: string[] = [];

  function read(addr: string): number | null {
    const cell = sheet!.getCell(addr);
    const raw = cell.value;

    if (raw === null || raw === undefined) return null;

    // Formula cells come back as { formula, result } -- use the cached
    // result rather than re-evaluating (we don't have a calc engine here).
    if (typeof raw === "object" && "result" in (raw as any)) {
      const result = (raw as any).result;
      if (typeof result === "string" && result.startsWith("#")) {
        warnings.push(`${addr} contains a formula error (${result}) in the source workbook`);
        return null;
      }
      return typeof result === "number" ? result : null;
    }

    if (typeof raw === "number") return raw;

    // Non-numeric value where a number was expected (e.g. someone typed
    // "TBD") -- flag it rather than silently returning null.
    warnings.push(`${addr} expected a number, found "${raw}"`);
    return null;
  }

  const summary = Object.fromEntries(
    Object.entries(CELLS).map(([key, addr]) => [key, read(addr)])
  ) as Omit<ReturnsSummary, "warnings">;

  return { ...summary, warnings };
}
